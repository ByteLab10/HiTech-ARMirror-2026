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
//       Created once in JS and appended to <body>. Positioned bottom-left.
//
//  4. Preview canvas scale fix
//       After drawing the captured image onto photo-preview-canvas, its CSS
//       width/height are set via JS so it fits the screen without zooming.
//
//  5. Top Corner Action Buttons (Fixes applied)
//       - Force-clears any old background images from CSS so only the SVG shows.
//       - Automatically hides the Tick/Approve button once the QR is generated.
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
// Layout constants
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
// State
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
// Dynamically created UI
// ---------------------------------------------------------------------------
let uploadLoaderEl: HTMLDivElement | null = null;
let qrOverlayEl:   HTMLDivElement | null = null;

/** Enhances the action buttons into beautiful top-corner circular icons */
function styleTopCornerButtons() {
  if (closePreviewBtn) {
    // Inject "X" SVG Icon
    closePreviewBtn.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    Object.assign(closePreviewBtn.style, {
      position: 'fixed',
      top: '40px',
      left: '40px',
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      backgroundColor: '#ffffff',
      backgroundImage: 'none', // Force override any old CSS background icons
      border: '4px solid #000000',
      display: 'none', 
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: '1005',
      boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
      padding: '0',
      color: 'transparent',
      transition: 'opacity 0.2s ease-in-out'
    });
  }

  if (downloadImageBtn) {
    // Inject "Tick/Approve" SVG Icon
    downloadImageBtn.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    Object.assign(downloadImageBtn.style, {
      position: 'fixed',
      top: '40px',
      right: '40px',
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      backgroundColor: '#ffffff',
      backgroundImage: 'none', // Force override any old CSS background icons
      border: '4px solid #000000',
      display: 'none', 
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: '1005',
      boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
      padding: '0',
      color: 'transparent',
      transition: 'opacity 0.2s ease-in-out'
    });
  }
}

/** Creates the upload loading overlay once and appends it to <body>. */
function createUploadLoader(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position:        'fixed',
    inset:           '0',
    zIndex:          '1010',
    background:      'rgba(0,0,0,0.65)',
    display:         'none',
    flexDirection:   'column',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             '16px',
  });

  const spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width:       '52px',
    height:      '52px',
    border:      '4px solid rgba(255,255,255,0.25)',
    borderTop:   '4px solid #fff',
    borderRadius:'50%',
    animation:   'mirrorSpin 0.75s linear infinite',
  });

  if (!document.getElementById('mirror-spin-style')) {
    const style = document.createElement('style');
    style.id        = 'mirror-spin-style';
    style.textContent = '@keyframes mirrorSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

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
    bottom:         '40px',
    left:           '40px',
    zIndex:         '1005',
    display:        'none',
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
// Canvas / render-size helpers
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
// Bootstrap
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

  // Initialize UI Enhancements
  uploadLoaderEl = createUploadLoader();
  qrOverlayEl    = createQrOverlay();
  styleTopCornerButtons();

  updateCameraCanvasSize();
  await initCameraKit();
});

// ---------------------------------------------------------------------------
// CameraKit init
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
    await setCameraKitSource(cameraKitSession, true);
    setupCaptureUI();
    hideSplashLoader();
  } catch (error) {
    console.error('Failed to initialize CameraKit:', error);
  }
}

// ---------------------------------------------------------------------------
// Camera source
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
// UI wiring
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
// Lens carousel
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
      photoPreviewCanvas.width  = camerakitCanvas.width;   
      photoPreviewCanvas.height = camerakitCanvas.height;  

      const ctx = photoPreviewCanvas.getContext('2d');
      if (ctx) {
        const img   = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, photoPreviewCanvas.width, photoPreviewCanvas.height);
          ctx.drawImage(img, 0, 0);

          const scaleW = window.innerWidth  / photoPreviewCanvas.width;
          const scaleH = window.innerHeight / photoPreviewCanvas.height;
          const scale  = Math.min(scaleW, scaleH);         
          photoPreviewCanvas.style.width  = `${Math.round(photoPreviewCanvas.width  * scale)}px`;
          photoPreviewCanvas.style.height = `${Math.round(photoPreviewCanvas.height * scale)}px`;

          photoPreviewCanvas.style.display = 'block';
          camerakitCanvas!.style.display   = 'none';
        };
        img.src = capturedImageData;
      }
    }

    captureBtn?.style.setProperty('display', 'none');
    
    // Reset and show the buttons on a fresh capture
    if (downloadImageBtn) {
      downloadImageBtn.style.display = 'flex';
      downloadImageBtn.disabled = false;
      downloadImageBtn.style.opacity = '1';
    }
    
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
// closePreview
// ---------------------------------------------------------------------------
function closePreview() {
  capturedImageData = null;

  const previewCanvas = document.getElementById('photo-preview-canvas') as HTMLCanvasElement | null;
  if (previewCanvas) {
    previewCanvas.style.display = 'none';
    previewCanvas.style.width  = '';
    previewCanvas.style.height = '';
  }

  if (camerakitCanvas) camerakitCanvas.style.display = 'block';

  if (downloadImageBtn) {
    downloadImageBtn.style.display = 'none';
    downloadImageBtn.disabled      = false;
    downloadImageBtn.style.opacity = '1'; 
  }
  
  if (closePreviewBtn) closePreviewBtn.style.display = 'none';
  if (captureBtn)      captureBtn.style.display      = 'flex';

  if (qrOverlayEl) qrOverlayEl.style.display = 'none';

  const leftCarousel  = document.getElementById('left-lens-carousel');
  const rightCarousel = document.getElementById('right-lens-carousel');
  if (leftCarousel)  leftCarousel.style.display  = 'flex';
  if (rightCarousel) rightCarousel.style.display = 'flex';
}

// ---------------------------------------------------------------------------
// uploadAndShowQR
// ---------------------------------------------------------------------------
async function uploadAndShowQR() {
  if (!capturedImageData) return;

  if (uploadLoaderEl)   uploadLoaderEl.style.display = 'flex';
  
  // Dim the button during upload
  if (downloadImageBtn) {
      downloadImageBtn.disabled = true;
      downloadImageBtn.style.opacity = '0.5';
  }

  try {
    const fileName   = `snaps/photo-${Date.now()}.png`;
    const storageRef = ref(storage, fileName);
    await uploadString(storageRef, capturedImageData, 'data_url');
    const downloadURL = await getDownloadURL(storageRef);
    console.log('Uploaded! URL:', downloadURL);

    const qrDataUrl = await QRCode.toDataURL(downloadURL, {
      width:  220,
      margin: 2,
      color:  { dark: '#000000', light: '#ffffff' },
    });

    if (uploadLoaderEl) uploadLoaderEl.style.display = 'none';

    // Completely remove the Tick/Approve button now that QR is showing!
    if (downloadImageBtn) {
      downloadImageBtn.style.display = 'none';
    }

    const qrImg = document.getElementById('qr-code-image') as HTMLImageElement | null;
    if (qrImg && qrOverlayEl) {
      qrImg.src                  = qrDataUrl;
      qrOverlayEl.style.display  = 'flex';
    }

  } catch (error) {
    console.error('Upload or QR generation failed:', error);
    if (uploadLoaderEl)   uploadLoaderEl.style.display = 'none';
    
    // Reactivate the button if it fails so they can try again
    if (downloadImageBtn) {
      downloadImageBtn.disabled = false;
      downloadImageBtn.style.opacity = '1';
    }
  }
}