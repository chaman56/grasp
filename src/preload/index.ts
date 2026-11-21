import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LensApi, Progress } from '../shared/types'

function subscribe<A extends unknown[]>(channel: string, listener: (...args: A) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]): void => listener(...(args as A))
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: LensApi = {
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  analyze: (root, mode) => ipcRenderer.invoke('project:analyze', root, mode),
  onProgress: (listener) => subscribe<[Progress]>('project:progress', listener),
  fileLines: (root, path, base) => ipcRenderer.invoke('project:file', root, path, base),
  projectState: (root) => ipcRenderer.invoke('project:state', root),
  setMark: (root, id, mark) => ipcRenderer.invoke('project:mark', root, id, mark),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveProvider: (input) => ipcRenderer.invoke('settings:saveProvider', input),
  deleteProvider: (id) => ipcRenderer.invoke('settings:deleteProvider', id),
  setActiveProvider: (id) => ipcRenderer.invoke('settings:setActive', id),
  listModels: (baseUrl, apiKey, providerId) => ipcRenderer.invoke('ai:models', baseUrl, apiKey, providerId),
  explain: (root, nodeId, hash, messages) => ipcRenderer.invoke('ai:explain', root, nodeId, hash, messages),
  onExplainDelta: (listener) => subscribe<[string, string]>('ai:delta', listener),
  cancelExplain: () => ipcRenderer.invoke('ai:cancel'),
  story: (root, key, nodeIds, messages) => ipcRenderer.invoke('ai:story', root, key, nodeIds, messages),
}

contextBridge.exposeInMainWorld('lens', api)
