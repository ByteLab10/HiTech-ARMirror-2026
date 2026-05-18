// =============================================================================
//  main.ts
//
//  HTML and CSS are UNCHANGED from the original.
//  Only logic changes vs the original main.ts:
//
//  1. downloadImage() → uploadAndShowQR()
//       Uploads to Firebase Storage instead of triggering a local download.
//
//  2. Loading overlay
//       Created once in JS and appended to <body>. No HTML/CSS changes needed.
//
//  3. QR code overlay
//       Created once in JS and appended to <body>. Positioned bottom-left over
//       the preview canvas. Hidden/shown in sync with the preview.
//
//  4. Preview canvas scale fix
//       After drawing the captured image onto photo-preview-canvas, its CSS
//       width/height are set via JS so it fits the screen without zooming.
//       The existing CSS (centered with translate(-50%,-50%)) still applies;
//       only the rendered size changes.
// =============================================================================

import { initializeApp }                        from 'firebase/app';
import { getStorage, ref, uploadString,
         getDownloadURL }                        from 'firebase/storage';
import QRCode                                   from 'qrcode';
import {
  bootstrapCameraKit,
  CameraKitSession,
  createMediaStreamSource,
  Transform2D,
}                                               from '@snap/camera-kit';
import { APP_CONFIG }                           from './AppConfig';

// ---------------------------------------------------------------------------
// Layout constants — identical to original
// ---------------------------------------------------------------------------
const BUTTON_WIDTH        = 60;
const BUTTON_MARGIN       = 30;
const LENS_SPACING        = 10;
const CAROUSEL_HEIGHT     = 60;
const TARGET_RENDER_WIDTH  = 2160;
const TARGET_RENDER_HEIGHT = 3840;

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey:            'AIzaSyBaOgkKy9v3QkNg0cAFnHijoTq5T4vYkWU',
  authDomain:        'hi-tech-mirror-snaps-24.firebaseapp.com',
  projectId:         'hi-tech-mirror-snaps-24',
  storageBucket:     'hi-tech-mirror-snaps-24.firebasestorage.app',
  messagingSenderId: '551381554057',
  appId:             '1:551381554057:web:4d553a7b6d8ace04b60758',
  measurementId:     'G-S551BSHQQH',
};
const firebaseApp = initializeApp(firebaseConfig);
const storage     = getStorage(firebaseApp);

// ---------------------------------------------------------------------------
// State — identical to original
// ---------------------------------------------------------------------------
let cameraKitSession: CameraKitSession | null = null;
let mediaStream:      MediaStream | null       = null;
let cameraSource:     any                      = null;
let camerakitCanvas:  HTMLCanvasElement | null = null;
let captureBtn:       HTMLButtonElement | null = null;
let downloadImageBtn: HTMLButtonElement | null = null;
let closePreviewBtn:  HTMLButtonElement | null = null;
let capturedImageData: string | null           = null;
let allLenses:         any[]                   = [];
let currentLensIndex:  number                  = 0;

// ---------------------------------------------------------------------------
// Dynamically created UI — keeps HTML/CSS untouched
// ---------------------------------------------------------------------------
let uploadLoaderEl: HTMLDivElement | null = null;
let qrOverlayEl:   HTMLDivElement | null = null;

/** Creates the upload loading overlay once and appends it to <body>. */
function createUploadLoader(): HTMLDivElement {
  const el = document.createElement('div');
  // Inline styles so no CSS file changes are needed
  Object.assign(el.style, {
    position:        'fixed',
    inset:           '0',
    zIndex:          '1010',
    background:      'rgba(0,0,0,0.65)',
    display:         'none',           // shown via JS
    flexDirection:   'column',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             '16px',
  });

  // Spinner
  const spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width:       '52px',
    height:      '52px',
    border:      '4px solid rgba(255,255,255,0.25)',
    borderTop:   '4px solid #fff',
    borderRadius:'50%',
    animation:   'mirrorSpin 0.75s linear infinite',
  });

  // Inject keyframes once
  if (!document.getElementById('mirror-spin-style')) {
    const style = document.createElement('style');
    style.id        = 'mirror-spin-style';
    style.textContent = '@keyframes mirrorSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  // Label
  const label = document.createElement('p');
  label.textContent = 'Uploading your snap…';
  Object.assign(label.style, {
    color:      '#fff',
    fontSize:   '16px',
    fontWeight: '600',
    margin:     '0',
  });

  el.appendChild(spinner);
  el.appendChild(label);
  document.body.appendChild(el);
  return el;
}

/** Creates the QR code overlay once and appends it to <body>. */
function createQrOverlay(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position:       'fixed',
    bottom:         '24px',
    left:           '24px',
    zIndex:         '1005',
    display:        'none',            // shown via JS after upload
    flexDirection:  'column',
    alignItems:     'center',
    gap:            '6px',
    background:     'rgba(255,255,255,0.96)',
    borderRadius:   '12px',
    padding:        '10px',
    boxShadow:      '0 4px 20px rgba(0,0,0,0.5)',
  });

  const qrImg = document.createElement('img');
  qrImg.id = 'qr-code-image';
  Object.assign(qrImg.style, {
    width:        '150px',
    height:       '150px',
    display:      'block',
    borderRadius: '4px',
  });

  const qrLabel = document.createElement('span');
  qrLabel.textContent = 'Scan to save photo';
  Object.assign(qrLabel.style, {
    fontSize:   '11px',
    fontWeight: '600',
    color:      '#111',
    textAlign:  'center',
  });

  el.appendChild(qrImg);
  el.appendChild(qrLabel);
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Canvas / render-size helpers — identical to original
// ---------------------------------------------------------------------------
function updateCameraCanvasSize() {
  if (!camerakitCanvas) return null;
  if (
    camerakitCanvas.width  !== TARGET_RENDER_WIDTH ||
    camerakitCanvas.height !== TARGET_RENDER_HEIGHT
  ) {
    camerakitCanvas.width  = TARGET_RENDER_WIDTH;
    camerakitCanvas.height = TARGET_RENDER_HEIGHT;
  }
  camerakitCanvas.style.width  = '100vw';
  camerakitCanvas.style.height = '100vh';
  return { width: TARGET_RENDER_WIDTH, height: TARGET_RENDER_HEIGHT };
}

function resizeCameraRender() {
  const renderSize = updateCameraCanvasSize();
  if (cameraSource && renderSize && typeof cameraSource.setRenderSize === 'function') {
    cameraSource.setRenderSize(renderSize.width, renderSize.height);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — identical to original
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  camerakitCanvas  = document.getElementById('CameraKit-AR-Canvas') as HTMLCanvasElement | null;
  captureBtn       = document.getElementById('capture-btn')          as HTMLButtonElement | null;
  downloadImageBtn = document.getElementById('download-btn')         as HTMLButtonElement | null;
  closePreviewBtn  = document.getElementById('close-btn')            as HTMLButtonElement | null;

  document.documentElement.style.setProperty('--button-width',    `${BUTTON_WIDTH}px`);
  document.documentElement.style.setProperty('--button-margin',   `${BUTTON_MARGIN}px`);
  document.documentElement.style.setProperty('--lens-spacing',    `${LENS_SPACING}px`);
  document.documentElement.style.setProperty('--carousel-height', `${CAROUSEL_HEIGHT}px`);

  window.addEventListener('resize',            resizeCameraRender);
  window.addEventListener('orientationchange', resizeCameraRender);

  // Create dynamic UI elements (appended to body, no HTML changes)
  uploadLoaderEl = createUploadLoader();
  qrOverlayEl    = createQrOverlay();

  updateCameraCanvasSize();
  await initCameraKit();
});

// ---------------------------------------------------------------------------
// CameraKit init — identical to original
// ---------------------------------------------------------------------------
async function initCameraKit() {
  if (!camerakitCanvas) {
    console.error('CameraKit canvas not found');
    return;
  }
  try {
    const cameraKit  = await bootstrapCameraKit({ apiToken: APP_CONFIG.CAMERA_KIT_API_TOKEN });
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
    currentLensIndex        = selectedLensIndex >= 0 ? selectedLensIndex : 0;
    const selectedLens      = lenses[currentLensIndex];
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

// ---------------------------------------------------------------------------
// Camera source — identical to original
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// UI wiring — identical to original
// ---------------------------------------------------------------------------
function setupCaptureUI() {
  if (!captureBtn || !downloadImageBtn || !closePreviewBtn) return;

  captureBtn.style.display = 'flex';
  captureBtn.addEventListener('click',       capturePhoto);
  closePreviewBtn.addEventListener('click',  closePreview);
  downloadImageBtn.addEventListener('click', uploadAndShowQR);
}

function hideSplashLoader() {
  const loader = document.getElementById('splash-loader');
  document.body.classList.add('splash-hidden');
  if (loader) loader.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Lens carousel — identical to original
// ---------------------------------------------------------------------------
function createLensCarousel(lenses: any[]) {
  const leftCarousel     = document.createElement('div');
  leftCarousel.id        = 'left-lens-carousel';
  leftCarousel.className = 'left-lens-carousel';

  const rightCarousel     = document.createElement('div');
  rightCarousel.id        = 'right-lens-carousel';
  rightCarousel.className = 'right-lens-carousel';

  const mid = Math.floor(lenses.length / 2);

  lenses.forEach((lens, index) => {
    const lensItem     = document.createElement('div');
    lensItem.className = 'lens-item';
    if (index === currentLensIndex) lensItem.classList.add('active');

    const img   = document.createElement('img');
    img.src     = lens.iconUrl || '/default-lens-icon.png';
    img.alt     = lens.name    || `Lens ${index + 1}`;
    img.onerror = () => { img.src = '/default-lens-icon.png'; };

    lensItem.appendChild(img);
    lensItem.addEventListener('click', () => switchLens(index));

    if (index < mid) leftCarousel.appendChild(lensItem);
    else             rightCarousel.appendChild(lensItem);
  });

  document.body.appendChild(leftCarousel);
  document.body.appendChild(rightCarousel);

  if (currentLensIndex < mid) {
    (leftCarousel.children[currentLensIndex] as HTMLElement)
      .scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
  } else {
    (rightCarousel.children[currentLensIndex - mid] as HTMLElement)
      .scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
  }
}

async function switchLens(index: number) {
  if (!cameraKitSession || index === currentLensIndex) return;
  try {
    const lens = allLenses[index];
    await cameraKitSession.applyLens(lens);
    console.log(`Switched to lens ${lens.id}`);

    const mid           = Math.floor(allLenses.length / 2);
    const oldCarouselId = currentLensIndex < mid ? 'left-lens-carousel' : 'right-lens-carousel';
    const newCarouselId = index            < mid ? 'left-lens-carousel' : 'right-lens-carousel';
    const oldItemIndex  = currentLensIndex < mid ? currentLensIndex     : currentLensIndex - mid;
    const newItemIndex  = index            < mid ? index                : index - mid;

    const oldCarousel = document.getElementById(oldCarouselId);
    const newCarousel = document.getElementById(newCarouselId);

    (oldCarousel?.children[oldItemIndex] as HTMLElement | undefined)?.classList.remove('active');

    const newItem = newCarousel?.children[newItemIndex] as HTMLElement | undefined;
    if (newItem) {
      newItem.classList.add('active');
      newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    currentLensIndex = index;
  } catch (error) {
    console.error('Failed to switch lens:', error);
  }
}

// ---------------------------------------------------------------------------
// capturePhoto
// Same logic as original PLUS a scale fix so the preview canvas fits the
// screen without zooming (no CSS change — sizes are set via JS).
// ---------------------------------------------------------------------------
function capturePhoto() {
  if (!camerakitCanvas) {
    console.error('Canvas not found');
    return;
  }
  try {
    capturedImageData = camerakitCanvas.toDataURL('image/png');

    const photoPreviewCanvas = document.getElementById('photo-preview-canvas') as HTMLCanvasElement | null;
    if (photoPreviewCanvas) {
      photoPreviewCanvas.width  = camerakitCanvas.width;   // 2160
      photoPreviewCanvas.height = camerakitCanvas.height;  // 3840

      const ctx = photoPreviewCanvas.getContext('2d');
      if (ctx) {
        const img   = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, photoPreviewCanvas.width, photoPreviewCanvas.height);
          ctx.drawImage(img, 0, 0);

          // ── FIX: scale canvas to fit screen while keeping aspect ratio ──
          // The existing CSS centres it (position:fixed; top/left 50%; translate).
          // We just set the CSS display size so it doesn't render at 2160×3840.
          const scaleW = window.innerWidth  / photoPreviewCanvas.width;
          const scaleH = window.innerHeight / photoPreviewCanvas.height;
          const scale  = Math.min(scaleW, scaleH);         // contain, no crop
          photoPreviewCanvas.style.width  = `${Math.round(photoPreviewCanvas.width  * scale)}px`;
          photoPreviewCanvas.style.height = `${Math.round(photoPreviewCanvas.height * scale)}px`;

          photoPreviewCanvas.style.display = 'block';
          camerakitCanvas!.style.display   = 'none';
        };
        img.src = capturedImageData;
      }
    }

    captureBtn?.style.setProperty('display', 'none');
    downloadImageBtn?.style.setProperty('display', 'flex');
    closePreviewBtn?.style.setProperty('display', 'flex');

    const leftCarousel  = document.getElementById('left-lens-carousel');
    const rightCarousel = document.getElementById('right-lens-carousel');
    if (leftCarousel)  leftCarousel.style.display  = 'none';
    if (rightCarousel) rightCarousel.style.display = 'none';
  } catch (error) {
    console.error('Failed to capture photo:', error);
  }
}

// ---------------------------------------------------------------------------
// closePreview — same as original + hides the QR overlay
// ---------------------------------------------------------------------------
function closePreview() {
  capturedImageData = null;

  const previewCanvas = document.getElementById('photo-preview-canvas') as HTMLCanvasElement | null;
  if (previewCanvas) {
    previewCanvas.style.display = 'none';
    // Reset JS-set sizes so next capture recalculates correctly
    previewCanvas.style.width  = '';
    previewCanvas.style.height = '';
  }

  if (camerakitCanvas) camerakitCanvas.style.display = 'block';

  // Reset download button
  if (downloadImageBtn) {
    downloadImageBtn.style.display = 'none';
    downloadImageBtn.disabled      = false;
  }
  if (closePreviewBtn) closePreviewBtn.style.display = 'none';
  if (captureBtn)      captureBtn.style.display      = 'flex';

  // Hide QR overlay
  if (qrOverlayEl) qrOverlayEl.style.display = 'none';

  const leftCarousel  = document.getElementById('left-lens-carousel');
  const rightCarousel = document.getElementById('right-lens-carousel');
  if (leftCarousel)  leftCarousel.style.display  = 'flex';
  if (rightCarousel) rightCarousel.style.display = 'flex';
}

// ---------------------------------------------------------------------------
// uploadAndShowQR — replaces the original downloadImage()
// Uploads to Firebase, shows a loading overlay while waiting, then displays
// the QR code over the preview canvas.
// ---------------------------------------------------------------------------
async function uploadAndShowQR() {
  if (!capturedImageData) return;

  // Show loading overlay
  if (uploadLoaderEl)   uploadLoaderEl.style.display = 'flex';
  if (downloadImageBtn) downloadImageBtn.disabled     = true;

  try {
    // 1. Upload to Firebase Storage
    const fileName   = `snaps/photo-${Date.now()}.png`;
    const storageRef = ref(storage, fileName);
    await uploadString(storageRef, capturedImageData, 'data_url');
    const downloadURL = await getDownloadURL(storageRef);
    console.log('Uploaded! URL:', downloadURL);

    // 2. Generate QR code pointing to the Firebase URL
    const qrDataUrl = await QRCode.toDataURL(downloadURL, {
      width:  220,
      margin: 2,
      color:  { dark: '#000000', light: '#ffffff' },
    });

    // 3. Hide loader
    if (uploadLoaderEl) uploadLoaderEl.style.display = 'none';

    // 4. Show QR overlay (bottom-left, over the preview canvas)
    const qrImg = document.getElementById('qr-code-image') as HTMLImageElement | null;
    if (qrImg && qrOverlayEl) {
      qrImg.src                  = qrDataUrl;
      qrOverlayEl.style.display  = 'flex';
    }

    if (downloadImageBtn) {
      downloadImageBtn.disabled = true;
    }
  } catch (error) {
    console.error('Upload or QR generation failed:', error);
    if (uploadLoaderEl)   uploadLoaderEl.style.display = 'none';
    if (downloadImageBtn) {
      downloadImageBtn.disabled = false;
    }
  }
}