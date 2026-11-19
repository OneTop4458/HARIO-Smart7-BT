export function drawRecipeCrop(canvas, image, zoom = 1, horizontal = 0.5, vertical = 0.5) {
  const size = Math.min(image.width, image.height) / zoom;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 256, 256);
  context.drawImage(image, (image.width - size) * horizontal, (image.height - size) * vertical, size, size, 0, 0, 256, 256);
}
