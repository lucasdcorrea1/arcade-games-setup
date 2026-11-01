'use strict';

// "Turbinar" tab: the paid add-on. It is bought on the site (which hands out the purchase
// code); here the code is pasted and the add-on installed on the cabinet over Wi-Fi.
// Loaded after renderer.js and uses its shared helpers ($, settings, svgIcon, setStatus,
// plainError).

const TB_SITE = 'https://lucasdcorrea1.github.io/arcade-do-zero/fliper/#turbinar';
let tbLicense = null;
let tbBusy = false;
let tbUninstallArmed = false;

// the three screens of a match, one after the other
(function cycleScreens() {
  const pics = [...document.querySelectorAll('#tbScreen img')];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || pics.length < 2) return;
  let i = 0;
  setInterval(() => {
    pics[i].classList.remove('on');
    i = (i + 1) % pics.length;
    pics[i].classList.add('on');
  }, 3200);
})();

function tbRenderLicense() {
  $('tbCodeForm').hidden = !!tbLicense;
  $('tbCodeOk').hidden = !tbLicense;
  $('tbBuyBox').hidden = !!tbLicense;
  if (tbLicense) $('tbCodeText').textContent = `Código ativo (compra ${tbLicense.serial}, ${tbLicense.issued.split('-').reverse().join('/')})`;
  $('tbInstall').disabled = !tbLicense || tbBusy;
}

async function tbLoad() {
  // renderer.js loads the connection settings at start: wait for them
  for (let i = 0; i < 40 && !settings; i++) await new Promise((r) => setTimeout(r, 100));
  const state = await window.api.turbinarState();
  tbLicense = state.license;
  $('tbVersion').textContent = state.version ? `pacote ${state.version}` : '';
  tbRenderLicense();
  tbCheck();
}

async function tbCheck() {
  if (!settings || !settings.host) {
    setStatus($('tbCheck'), 'Conecte o fliperama no botão Conectar, lá em cima.', 'err');
    return null;
  }
  setStatus($('tbCheck'), `Conferindo o fliperama em ${settings.host}…`);
  try {
    const info = await window.api.turbinarCheck(settings);
    if (info.problems.length) {
      setStatus($('tbCheck'), info.problems[0], 'err');
    } else if (info.upToDate) {
      setStatus($('tbCheck'), `${info.model || 'Fliperama'}: já está turbinado com a versão mais nova.`, 'ok');
      $('tbInstall').innerHTML = svgIcon('reload') + ' Instalar de novo';
    } else if (info.installed) {
      setStatus($('tbCheck'), `${info.model || 'Fliperama'}: tem uma versão antiga. Instale para atualizar.`);
      $('tbInstall').innerHTML = svgIcon('bolt') + ' Atualizar no fliperama';
    } else {
      setStatus($('tbCheck'), `${info.model || 'Fliperama'} pronto para turbinar (${info.free} MB livres).`, 'ok');
    }
    return info;
  } catch (err) {
    setStatus($('tbCheck'), 'Não achei o fliperama: ' + plainError(err), 'err');
    return null;
  }
}

function tbLog(text, percent) {
  const log = $('tbLog');
  let last = log.lastElementChild;
  if (!last || last.dataset.text !== text) {
    if (last) last.classList.add('done');
    last = document.createElement('li');
    last.dataset.text = text;
    log.appendChild(last);
  }
  last.textContent = percent != null ? `${text} (${percent}%)` : text;
}

window.api.onTurbinarProgress((p) => { if (tbBusy) tbLog(p.text, p.percent); });

$('tbBuy').addEventListener('click', () => window.api.openExternal(TB_SITE));

$('tbActivate').addEventListener('click', async () => {
  const res = await window.api.turbinarActivate($('tbCode').value);
  if (!res.ok) { setStatus($('tbCodeStatus'), res.reason, 'err'); return; }
  tbLicense = res;
  setStatus($('tbCodeStatus'), 'Pronto, código ativado.', 'ok');
  tbRenderLicense();
});

$('tbInstall').addEventListener('click', async () => {
  if (tbBusy || !requireHost()) return;
  tbBusy = true;
  tbRenderLicense();
  $('tbDone').hidden = true;
  $('tbLog').innerHTML = '';
  setStatus($('tbCheck'), 'Instalando… não desligue o fliperama.');
  try {
    const res = await window.api.turbinarInstall(settings);
    [...$('tbLog').children].forEach((li) => li.classList.add('done'));
    setStatus($('tbCheck'), 'Instalado.', 'ok');
    $('tbUrl').textContent = res.url;
    if (res.qr) $('tbQr').src = res.qr;
    $('tbQr').hidden = !res.qr;
    $('tbDone').hidden = false;
  } catch (err) {
    setStatus($('tbCheck'), plainError(err), 'err');
  } finally {
    tbBusy = false;
    tbRenderLicense();
  }
});

$('tbUninstall').addEventListener('click', async () => {
  if (tbBusy || !requireHost()) return;
  if (!tbUninstallArmed) {
    tbUninstallArmed = true;
    $('tbUninstall').textContent = 'Clique de novo para desinstalar (os jogadores ficam guardados)';
    setTimeout(() => { tbUninstallArmed = false; $('tbUninstall').textContent = 'Desinstalar do fliperama'; }, 5000);
    return;
  }
  tbUninstallArmed = false;
  $('tbUninstall').textContent = 'Desinstalar do fliperama';
  tbBusy = true;
  $('tbLog').innerHTML = '';
  $('tbDone').hidden = true;
  try {
    await window.api.turbinarUninstall(settings);
    setStatus($('tbCheck'), 'Desinstalado. O fliperama voltou a ser como era.', 'ok');
  } catch (err) {
    setStatus($('tbCheck'), plainError(err), 'err');
  } finally {
    tbBusy = false;
    tbRenderLicense();
  }
});

document.querySelector('.tab[data-tab="turbinar"]').addEventListener('click', tbCheck);
tbLoad();
