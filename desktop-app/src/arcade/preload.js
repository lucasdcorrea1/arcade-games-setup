'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arcade', {
  state: () => ipcRenderer.invoke('arcade:state'),
  play: (id, connected) => ipcRenderer.invoke('arcade:play', { id, connected }),
  saveSides: (sides) => ipcRenderer.invoke('arcade:saveSides', sides),
  favorite: (id, on) => ipcRenderer.invoke('arcade:favorite', { id, on }),
  savePads: (pads) => ipcRenderer.invoke('arcade:savePads', pads),
  openManager: () => ipcRenderer.invoke('arcade:openManager'),
  quit: () => ipcRenderer.invoke('arcade:quit'),
  minimize: () => ipcRenderer.invoke('arcade:minimize'),
  shutdown: () => ipcRenderer.invoke('arcade:shutdown'),
  office: {
    board: () => ipcRenderer.invoke('office:board'),
    story: (id) => ipcRenderer.invoke('office:story', id),
    gh: (name) => ipcRenderer.invoke('office:gh', name),
    study: () => ipcRenderer.invoke('study:load'),
    studyToggle: (id) => ipcRenderer.invoke('study:toggle', id),
    translate: (texts) => ipcRenderer.invoke('office:translate', texts),
    readme: (repo) => ipcRenderer.invoke('office:readme', repo),
    page: (name) => ipcRenderer.invoke('office:page', name),
    daily: (place) => ipcRenderer.invoke('office:daily', place),
    routinesToday: () => ipcRenderer.invoke('office:routinesToday'),
    post: (what, data) => ipcRenderer.invoke('office:post', { what, data })
  },
  volume: (way) => ipcRenderer.invoke('arcade:volume', way),
  topStats: () => ipcRenderer.invoke('top:stats'),
  claude: {
    list: () => ipcRenderer.invoke('claude:list'),
    read: (id) => ipcRenderer.invoke('claude:read', id)
  },
  music: {
    show: (bounds) => ipcRenderer.invoke('music:show', bounds),
    hide: () => ipcRenderer.invoke('music:hide'),
    key: (action) => ipcRenderer.invoke('music:key', action),
    type: (k) => ipcRenderer.send('music:type', k),
    volume: (delta) => ipcRenderer.invoke('music:volume', delta),
    toggle: () => ipcRenderer.invoke('music:toggle'),
    state: () => ipcRenderer.invoke('music:state'),
    onChanged: (cb) => ipcRenderer.on('music:changed', (_e, st) => cb(st))
  },
  phoneInfo: () => ipcRenderer.invoke('phone:info'),
  phoneFirewall: () => ipcRenderer.invoke('phone:firewall'),
  onRefresh: (cb) => ipcRenderer.on('arcade:refresh', () => cb()),
  onPlaying: (cb) => ipcRenderer.on('arcade:playing', (_e, d) => cb(d)),
  onEnded: (cb) => ipcRenderer.on('arcade:ended', (_e, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('arcade:progress', (_e, d) => cb(d))
});
