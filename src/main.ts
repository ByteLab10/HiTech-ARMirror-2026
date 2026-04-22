import {
  bootstrapCameraKit,
  CameraKitSession,
  createMediaStreamSource,
  Transform2D
} from '@snap/camera-kit';
import { APP_CONFIG } from './AppConfig';

// Configuration variables for easy access
const BUTTON_WIDTH = 60;
const BUTTON_MARGIN = 30;
const LENS_SPACING = 10;
const CAROUSEL_HEIGHT = 60;
const TARGET_RENDER_WIDTH = 2160;
const TARGET_RENDER_HEIGHT = 3840;

let cameraKitSession: CameraKitSession | null = null;
let mediaStream: MediaStream | null = null;
let cameraSource: any = null;
let camerakitCanvas: HTMLCanvasElement | null = null;
let captureBtn: HTMLButtonElement | null = null;
let downloadImageBtn: HTMLButtonElement | null = null;
let closePreviewBtn: HTMLButtonElement | null = null;
let capturedImageData: string | null = null;
let allLenses: any[] = [];
let currentLensIndex: number = 0;

function updateCameraCanvasSize() {
  if (!camerakitCanvas) return null;

  const renderWidth = TARGET_RENDER_WIDTH;
  const renderHeight = TARGET_RENDER_HEIGHT;

  if (camerakitCanvas.width !== renderWidth || camerakitCanvas.height !== renderHeight) {
    camerakitCanvas.width = renderWidth;
    camerakitCanvas.height = renderHeight;
  }

  camerakitCanvas.style.width = '100vw';
  camerakitCanvas.style.height = '100vh';

  return { width: renderWidth, height: renderHeight };
}

function resizeCameraRender() {
  const renderSize = updateCameraCanvasSize();
  if (cameraSource && renderSize && typeof cameraSource.setRenderSize === 'function') {
    cameraSource.setRenderSize(renderSize.width, renderSize.height);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  camerakitCanvas = document.getElementById('CameraKit-AR-Canvas') as HTMLCanvasElement | null;
  captureBtn = document.getElementById('capture-btn') as HTMLButtonElement | null;
  downloadImageBtn = document.getElementById('download-btn') as HTMLButtonElement | null;
  closePreviewBtn = document.getElementById('close-btn') as HTMLButtonElement | null;

  // Set CSS variables for easy configuration
  document.documentElement.style.setProperty('--button-width', `${BUTTON_WIDTH}px`);
  document.documentElement.style.setProperty('--button-margin', `${BUTTON_MARGIN}px`);
  document.documentElement.style.setProperty('--lens-spacing', `${LENS_SPACING}px`);
  document.documentElement.style.setProperty('--carousel-height', `${CAROUSEL_HEIGHT}px`);

  window.addEventListener('resize', resizeCameraRender);
  window.addEventListener('orientationchange', resizeCameraRender);

  updateCameraCanvasSize();
  await initCameraKit();
});

async function initCameraKit() {
  if (!camerakitCanvas) {
    console.error('CameraKit canvas not found');
    return;
  }

  try {
    const cameraKit = await bootstrapCameraKit({ apiToken: APP_CONFIG.CAMERA_KIT_API_TOKEN });
    cameraKitSession = await cameraKit.createSession({ liveRenderTarget: camerakitCanvas });

    cameraKitSession.events.addEventListener('error', (event) => {
      console.error('CameraKit session error:', event.detail);
    });

    const { lenses } = await cameraKit.lensRepository.loadLensGroups([APP_CONFIG.LENS_GROUP_ID]);

    if (!Array.isArray(lenses) || lenses.length === 0) {
      throw new Error(`No lenses found for lens group ${APP_CONFIG.LENS_GROUP_ID}`);
    }

    allLenses = lenses;
    const selectedLensIndex = lenses.findIndex((lens: any) => lens.id === APP_CONFIG.LENS_ID);
    currentLensIndex = selectedLensIndex >= 0 ? selectedLensIndex : 0;
    const selectedLens = lenses[currentLensIndex];
    await cameraKitSession.applyLens(selectedLens);
    console.log(`Applied lens ${selectedLens.id}`);

    createLensCarousel(lenses);
    await setCameraKitSource(cameraKitSession, false);
    setupCaptureUI();
    hideSplashLoader();
  } catch (error) {
    console.error('Failed to initialize CameraKit:', error);
  }
}

async function setCameraKitSource(session: CameraKitSession, useFrontCamera = false) {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? 'user' : 'environment' },
    audio: false,
  });

  const source = createMediaStreamSource(mediaStream, {
    cameraType: useFrontCamera ? 'user' : 'environment',
  });

  await session.setSource(source);
  cameraSource = source;

  if (useFrontCamera) {
    source.setTransform(Transform2D.MirrorX);
  }

  const renderSize = updateCameraCanvasSize();
  if (renderSize && typeof source.setRenderSize === 'function') {
    source.setRenderSize(renderSize.width, renderSize.height);
  } else if (typeof source.setRenderSize === 'function') {
    source.setRenderSize(1080, 1920);
  }

  session.play('live');
}

function setupCaptureUI() {
  if (!captureBtn || !downloadImageBtn || !closePreviewBtn) {
    return;
  }

  captureBtn.style.display = 'flex';
  captureBtn.addEventListener('click', capturePhoto);
  closePreviewBtn.addEventListener('click', closePreview);
  downloadImageBtn.addEventListener('click', downloadImage);
}

function hideSplashLoader() {
  const loader = document.getElementById('splash-loader');
  document.body.classList.add('splash-hidden');
  if (loader) {
    loader.style.display = 'none';
  }
}

function createLensCarousel(lenses: any[]) {
  const leftCarousel = document.createElement('div');
  leftCarousel.id = 'left-lens-carousel';
  leftCarousel.className = 'left-lens-carousel';

  const rightCarousel = document.createElement('div');
  rightCarousel.id = 'right-lens-carousel';
  rightCarousel.className = 'right-lens-carousel';

  const mid = Math.floor(lenses.length / 2);

  lenses.forEach((lens, index) => {
    const lensItem = document.createElement('div');
    lensItem.className = 'lens-item';
    if (index === currentLensIndex) {
      lensItem.classList.add('active');
    }

    const img = document.createElement('img');
    img.src = lens.iconUrl || '/default-lens-icon.png'; // Assuming lens has iconUrl, fallback to placeholder
    img.alt = lens.name || `Lens ${index + 1}`;
    img.onerror = () => {
      img.src = '/default-lens-icon.png'; // Fallback if icon fails
    };

    lensItem.appendChild(img);
    lensItem.addEventListener('click', () => switchLens(index));
    
    if (index < mid) {
      leftCarousel.appendChild(lensItem);
    } else {
      rightCarousel.appendChild(lensItem);
    }
  });

  document.body.appendChild(leftCarousel);
  document.body.appendChild(rightCarousel);

  // Center the initial active lens
  if (currentLensIndex < mid) {
    const item = leftCarousel.children[currentLensIndex] as HTMLElement;
    item.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
  } else {
    const item = rightCarousel.children[currentLensIndex - mid] as HTMLElement;
    item.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
  }
}

async function switchLens(index: number) {
  if (!cameraKitSession || index === currentLensIndex) return;

  try {
    const lens = allLenses[index];
    await cameraKitSession.applyLens(lens);
    console.log(`Switched to lens ${lens.id}`);

    // Update active class
    const mid = Math.floor(allLenses.length / 2);
    const oldCarouselId = currentLensIndex < mid ? 'left-lens-carousel' : 'right-lens-carousel';
    const newCarouselId = index < mid ? 'left-lens-carousel' : 'right-lens-carousel';
    const oldItemIndex = currentLensIndex < mid ? currentLensIndex : currentLensIndex - mid;
    const newItemIndex = index < mid ? index : index - mid;

    const oldCarousel = document.getElementById(oldCarouselId);
    const newCarousel = document.getElementById(newCarouselId);

    if (oldCarousel && oldCarousel.children[oldItemIndex]) {
      (oldCarousel.children[oldItemIndex] as HTMLElement).classList.remove('active');
    }

    if (newCarousel && newCarousel.children[newItemIndex]) {
      const newItem = newCarousel.children[newItemIndex] as HTMLElement;
      newItem.classList.add('active');
      newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    currentLensIndex = index;
  } catch (error) {
    console.error('Failed to switch lens:', error);
  }
}

function capturePhoto() {
  if (!camerakitCanvas) {
    console.error('Canvas not found');
    return;
  }

  try {
    capturedImageData = camerakitCanvas.toDataURL('image/png');
    const photoPreviewCanvas = document.getElementById('photo-preview-canvas') as HTMLCanvasElement | null;

    if (photoPreviewCanvas) {
      photoPreviewCanvas.width = camerakitCanvas.width;
      photoPreviewCanvas.height = camerakitCanvas.height;
      const ctx = photoPreviewCanvas.getContext('2d');

      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, photoPreviewCanvas.width, photoPreviewCanvas.height);
          ctx.drawImage(img, 0, 0);
          photoPreviewCanvas.style.display = 'block';
          camerakitCanvas!.style.display = 'none';
        };
        img.src = capturedImageData;
      }
    }

    captureBtn?.style.setProperty('display', 'none');
    downloadImageBtn?.style.setProperty('display', 'flex');
    closePreviewBtn?.style.setProperty('display', 'flex');

    // Hide carousel during preview
    const leftCarousel = document.getElementById('left-lens-carousel');
    if (leftCarousel) leftCarousel.style.display = 'none';
    const rightCarousel = document.getElementById('right-lens-carousel');
    if (rightCarousel) rightCarousel.style.display = 'none';
  } catch (error) {
    console.error('Failed to capture photo:', error);
  }
}

function closePreview() {
  capturedImageData = null;
  const previewCanvas = document.getElementById('photo-preview-canvas');

  if (previewCanvas) {
    previewCanvas.style.display = 'none';
  }

  if (camerakitCanvas) {
    camerakitCanvas.style.display = 'block';
  }

  if (downloadImageBtn) downloadImageBtn.style.display = 'none';
  if (closePreviewBtn) closePreviewBtn.style.display = 'none';
  if (captureBtn) captureBtn.style.display = 'flex';

  // Show carousel again
  const leftCarousel = document.getElementById('left-lens-carousel');
  if (leftCarousel) leftCarousel.style.display = 'flex';
  const rightCarousel = document.getElementById('right-lens-carousel');
  if (rightCarousel) rightCarousel.style.display = 'flex';
}

function downloadImage() {
  if (!capturedImageData) {
    return;
  }

  const a = document.createElement('a');
  a.href = capturedImageData;
  a.download = `photo-preview-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
