'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Safe, explicit API exposed to the renderer (contextIsolation is on).
contextBridge.exposeInMainWorld('api', {
  winMin: () => ipcRenderer.send('win:min'),
  winMax: () => ipcRenderer.send('win:max'),
  winClose: () => ipcRenderer.send('win:close'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getSystems: () => ipcRenderer.invoke('systems:get'),
  setBrowseUrl: (url) => ipcRenderer.send('browse:url', url),
  downloadGame: (pageUrl) => ipcRenderer.invoke('retrostic:download', pageUrl),

  // Batch auto-download (crawl a category, then download + send every game).
  batchStart: (args) => ipcRenderer.invoke('batch:start', args),
  batchControl: (action) => ipcRenderer.invoke('batch:control', action),
  batchState: () => ipcRenderer.invoke('batch:state'),
  onCrawlStatus: (cb) => ipcRenderer.on('crawl:status', (_e, d) => cb(d)),
  onCrawlDone: (cb) => ipcRenderer.on('crawl:done', (_e, d) => cb(d)),
  onQueueUpdate: (cb) => ipcRenderer.on('queue:update', (_e, d) => cb(d)),
  onQueueFinished: (cb) => ipcRenderer.on('queue:finished', (_e, d) => cb(d)),

  // Local ROM library on disk D:.
  pickLibraryDir: () => ipcRenderer.invoke('library:pickDir'),
  openLibrary: (folder) => ipcRenderer.invoke('library:open', folder),

  // Remote maintenance.
  piDisk: (settings) => ipcRenderer.invoke('pi:disk', settings),
  piReboot: (settings) => ipcRenderer.invoke('pi:reboot', settings),

  // EmulationStation themes.
  piThemes: (settings) => ipcRenderer.invoke('pi:themes', settings),
  piSetTheme: (settings, name) => ipcRenderer.invoke('pi:setTheme', { settings, name }),
  themesCatalog: () => ipcRenderer.invoke('themes:catalog'),
  themesThumb: (url, opts = {}) => ipcRenderer.invoke('themes:thumb', { url, ...opts }),
  themesCheck: (id) => ipcRenderer.invoke('themes:check', id),
  themesCheckAll: (ids) => ipcRenderer.invoke('themes:checkAll', ids),
  onThemesCompat: (cb) => ipcRenderer.on('themes:compat', (_e, d) => cb(d)),
  themesInstall: (settings, entry) => ipcRenderer.invoke('themes:install', { settings, entry }),
  themesRemove: (settings, name, current) => ipcRenderer.invoke('themes:remove', { settings, name, current }),
  themesBundled: () => ipcRenderer.invoke('themes:bundled'),
  themesUseBundled: (settings) => ipcRenderer.invoke('themes:useBundled', settings),
  onThemesProgress: (cb) => ipcRenderer.on('themes:progress', (_e, d) => cb(d)),

  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  testConnection: (settings) => ipcRenderer.invoke('sftp:test', settings),
  discover: (settings) => ipcRenderer.invoke('net:discover', settings),
  onDiscoverStatus: (cb) => ipcRenderer.on('discover:status', (_e, d) => cb(d)),
  listGames: (settings, folder) => ipcRenderer.invoke('sftp:list', { settings, folder }),
  upload: (settings, job) => ipcRenderer.invoke('sftp:upload', { settings, job }),
  setCover: (settings, job) => ipcRenderer.invoke('sftp:setCover', { settings, job }),
  scanLibrary: (settings) => ipcRenderer.invoke('library:scan', settings),
  deleteGame: (settings, job) => ipcRenderer.invoke('sftp:deleteGame', { settings, job }),
  onLibraryBegin: (cb) => ipcRenderer.on('library:begin', (_e, d) => cb(d)),
  onLibrarySystem: (cb) => ipcRenderer.on('library:system', (_e, d) => cb(d)),
  onLibraryDone: (cb) => ipcRenderer.on('library:done', (_e, d) => cb(d)),
  onLibraryLogo: (cb) => ipcRenderer.on('library:logo', (_e, d) => cb(d)),
  onLibraryImage: (cb) => ipcRenderer.on('library:image', (_e, d) => cb(d)),
  restartES: (settings) => ipcRenderer.invoke('ssh:restartES', settings),

  // Download lifecycle events coming from the embedded browser.
  onDownloadStarted: (cb) => ipcRenderer.on('download:started', (_e, d) => cb(d)),
  onDownloadProgress: (cb) => ipcRenderer.on('download:progress', (_e, d) => cb(d)),
  onDownloadReady: (cb) => ipcRenderer.on('download:ready', (_e, d) => cb(d)),
  onDownloadFailed: (cb) => ipcRenderer.on('download:failed', (_e, d) => cb(d)),

  // Upload progress.
  onUploadProgress: (cb) => ipcRenderer.on('upload:progress', (_e, d) => cb(d)),

  // "Novo fliperama": prepare an SD card and set up a brand-new Raspberry Pi.
  setupPiInfo: (settings) => ipcRenderer.invoke('setup:piInfo', settings),
  setupImages: () => ipcRenderer.invoke('setup:images'),
  setupDisks: () => ipcRenderer.invoke('setup:disks'),
  setupWifi: (withKey) => ipcRenderer.invoke('setup:wifi', withKey),
  setupWrite: (args) => ipcRenderer.invoke('setup:write', args),
  setupFind: () => ipcRenderer.invoke('setup:find'),
  onSetupProgress: (cb) => ipcRenderer.on('setup:progress', (_e, d) => cb(d)),
  onSetupStatus: (cb) => ipcRenderer.on('setup:status', (_e, d) => cb(d))
});
