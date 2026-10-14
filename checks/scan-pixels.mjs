// Independent decoding of existing JPEG fixtures; no reference-generator code.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

export function decodeCover(file) {
  const result = spawnSync('python', ['-c',
    "from PIL import Image;import struct,sys;im=Image.open(sys.argv[1]).convert('RGBA');im.thumbnail((640,640),Image.Resampling.BILINEAR);sys.stdout.buffer.write(struct.pack('>II',im.width,im.height)+im.tobytes())", file],
    {maxBuffer: 640 * 640 * 4 + 4096});
  assert.equal(result.status, 0, result.stderr?.toString());
  return {width: result.stdout.readUInt32BE(0), height: result.stdout.readUInt32BE(4), data: new Uint8ClampedArray(result.stdout.subarray(8))};
}

export function guidedCameraFrame(image) {
  // Independently specified 480x640 camera / 320x420 viewport fixture.
  // Expected guide is x59.19 y61.7 w361.62 h516.6 under object-fit:cover.
  const width = 480, height = 640, data = new Uint8ClampedArray(width * height * 4).fill(40);
  for (let y = 0; y < 516; y++) for (let x = 0; x < 362; x++) {
    const sx = Math.min(image.width - 1, Math.floor(x * image.width / 362)), sy = Math.min(image.height - 1, Math.floor(y * image.height / 516));
    for (let channel = 0; channel < 4; channel++) data[((y + 62) * width + x + 59) * 4 + channel] = image.data[(sy * image.width + sx) * 4 + channel];
  }
  return {width, height, data};
}
