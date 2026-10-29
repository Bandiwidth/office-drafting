import { inflateRawSync, deflateRawSync } from 'node:zlib';

export function unzip(buffer) {
  if (buffer.length < 22) throw new Error('Invalid DOCX archive.');
  const minimum=Math.max(0,buffer.length-65557);let end=buffer.length-22;
  while(end>=minimum&&(buffer.readUInt32LE(end)!==0x06054b50||end+22+buffer.readUInt16LE(end+20)!==buffer.length))end--;
  if(end<minimum)throw new Error('Invalid ZIP directory.');
  if(buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||buffer.readUInt16LE(end+8)!==buffer.readUInt16LE(end+10))throw new Error('Multi-volume archives are not supported.');
  const count = buffer.readUInt16LE(end + 10);
  if (count > 2000) throw new Error('Document contains too many files.');
  let offset=buffer.readUInt32LE(end+16),total=0;const directoryStart=offset,directoryEnd=offset+buffer.readUInt32LE(end+12);
  if(directoryEnd>end)throw new Error('Damaged archive directory.');
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if(offset+46>directoryEnd||buffer.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid archive entry.');
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 24);
    const compressed = buffer.readUInt32LE(offset + 20), nl = buffer.readUInt16LE(offset + 28);
    const next=offset+46+nl+buffer.readUInt16LE(offset+30)+buffer.readUInt16LE(offset+32);
    if(next>directoryEnd)throw new Error('Damaged archive entry.');
    const name = buffer.subarray(offset + 46, offset + 46 + nl).toString('utf8');
    const local = buffer.readUInt32LE(offset + 42);
    if (!name||name.includes('..')||name.startsWith('/')||name.includes('\\')||/[:\x00]/.test(name)||(buffer.readUInt16LE(offset+8)&1)) throw new Error('Unsafe or encrypted document archive.');
    total += size;
    if (total > 60 * 1024 * 1024 || size > 20 * 1024 * 1024) throw new Error('Expanded document exceeds the limit.');
    if(local+30>directoryStart||buffer.readUInt32LE(local)!==0x04034b50)throw new Error('Damaged archive local record.');
    const localNameLength=buffer.readUInt16LE(local+26),start=local+30+localNameLength+buffer.readUInt16LE(local+28);
    if(start+compressed>directoryStart||buffer.subarray(local+30,local+30+localNameLength).toString('utf8')!==name||buffer.readUInt16LE(local+8)!==method||(buffer.readUInt16LE(local+6)&1))throw new Error('Damaged archive local record.');
    const packed = buffer.subarray(start, start + compressed);
    let data;try{data=method===0?packed:method===8?inflateRawSync(packed,{maxOutputLength:20*1024*1024}):null;}catch{throw new Error('Unsupported or damaged archive.');}
    if (!data || data.length !== size) throw new Error('Unsupported or damaged archive.');
    if(crc32(data)!==buffer.readUInt32LE(offset+16))throw new Error('Damaged archive: checksum mismatch.');
    if (entries.has(name)) throw new Error('Duplicate archive entry.');
    entries.set(name, data);
    offset=next;
  }
  if(offset!==directoryEnd)throw new Error('Damaged archive directory.');
  return entries;
}
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(buf) { let crc = 0xffffffff; for (const b of buf) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export function zip(entries) {
  const files = [], directory = []; let offset = 0;
  for (const [name, value] of entries) {
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(value), packed = deflateRawSync(raw), n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); h.copy(c, 6, 4, 30); c.writeUInt32LE(offset, 42);
    files.push(h, n, packed); directory.push(c, n); offset += h.length + n.length + packed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, dir, end]);
}
