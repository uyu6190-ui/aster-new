export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous'); // needed to avoid cross-origin issues on CodeSandbox
    image.src = url;
  });

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation = 0
): Promise<string> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return '';
  }

  // Set width and height for reasonable quality while respecting Firestore limits
  const targetSize = 600; 

  canvas.width = targetSize;
  canvas.height = targetSize;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    targetSize,
    targetSize
  );

  // Return as base64 with lower quality to guarantee success under 1MB limit
  return canvas.toDataURL('image/jpeg', 0.6);
}

export async function shrinkImage(fileOrBase64: File | string, maxWidth = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = (src: string) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxWidth) {
            if (width > height) {
              height *= maxWidth / width;
              width = maxWidth;
            } else {
              width *= maxWidth / height;
              height = maxWidth;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas context failed'));
          
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(img, 0, 0, width, height);
          
          // Lower quality to ensure it fits well within limits
          const result = canvas.toDataURL('image/jpeg', 0.6);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    };

    if (fileOrBase64 instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => process(e.target?.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(fileOrBase64);
    } else {
      process(fileOrBase64);
    }
  });
}
