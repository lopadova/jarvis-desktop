/** Wraps 16-bit little-endian mono PCM in a canonical 44-byte RIFF/WAVE header. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 16_000, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  const blockAlign = channels * 2;
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}
