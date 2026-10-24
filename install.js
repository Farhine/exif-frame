// Botón "Instalar". Chrome/Edge ofrecen un diálogo propio (beforeinstallprompt);
// en el resto (iPhone, Firefox, Samsung Internet…) se muestran los pasos a mano.

const installBtn = document.getElementById('install');
const installHelp = document.getElementById('install-help');
const installSteps = document.getElementById('install-steps');
let installPrompt = null;

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function installInstructions() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIOS && /CriOS|FxiOS|EdgiOS/.test(ua)) {
    return ['En iPhone solo se puede instalar desde <strong>Safari</strong>.', 'Abre esta misma página en Safari y sigue los pasos que aparecerán ahí.'];
  }
  if (isIOS) {
    return ['Toca el botón <strong>Compartir</strong> (el cuadrado con la flecha ⬆️).', 'Baja y elige <strong>Agregar a pantalla de inicio</strong>.', 'Toca <strong>Agregar</strong>.'];
  }
  if (/SamsungBrowser/.test(ua)) {
    return ['Toca el menú <strong>☰</strong> abajo.', 'Elige <strong>Agregar página a</strong> → <strong>Pantalla de inicio</strong>.'];
  }
  if (/Android/.test(ua)) {
    return ['Toca el menú <strong>⋮</strong> arriba a la derecha.', 'Elige <strong>Instalar app</strong> o <strong>Agregar a pantalla principal</strong>.'];
  }
  if (/Firefox/.test(ua)) {
    return ['Firefox en computadora no instala apps web.', 'Abre esta página en <strong>Chrome</strong> o <strong>Edge</strong> y toca Instalar.'];
  }
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua)) {
    return ['En el menú <strong>Archivo</strong> elige <strong>Agregar al Dock</strong>.'];
  }
  return ['Toca el ícono de instalar <strong>⊕</strong> a la derecha de la barra de direcciones,', 'o abre el menú <strong>⋮</strong> → <strong>Instalar EXIF Frame</strong>.', 'Si no aparece, puede que ya esté instalada: búscala en tus apps.'];
}

function showInstallHelp() {
  installSteps.innerHTML = installInstructions().map((s) => `<li>${s}</li>`).join('');
  installHelp.showModal();
}

installBtn.hidden = isStandalone();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

installBtn.addEventListener('click', async () => {
  if (!installPrompt) {
    showInstallHelp();
    return;
  }
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === 'accepted') installBtn.hidden = true;
});

window.addEventListener('appinstalled', () => { installBtn.hidden = true; });
