import { manageLocalStorage } from "../utils/localProcessing"

const DEVICE_DB_NAME = 'dailynotes-device'
const DEVICE_DB_VERSION = 1
const DEVICE_STORE_NAME = 'kv'

const hasIndexedDB = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'

let dbPromise: Promise<IDBDatabase | null> | null = null

const openDeviceDB = () => {
  if (!hasIndexedDB()) return Promise.resolve<IDBDatabase | null>(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise(resolve => {
    try {
      const request = window.indexedDB.open(DEVICE_DB_NAME, DEVICE_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(DEVICE_STORE_NAME)) {
          db.createObjectStore(DEVICE_STORE_NAME)
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

const runRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
})

const waitForTransaction = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
})

const readFromIndexedDB = async (key: string): Promise<string | undefined | null> => {
  const db = await openDeviceDB()
  if (!db) return null
  try {
    const store = db.transaction(DEVICE_STORE_NAME, 'readonly').objectStore(DEVICE_STORE_NAME)
    return await runRequest<string | undefined>(store.get(key))
  }
  catch { return null }
}

const writeToIndexedDB = async (key: string, value: string): Promise<boolean> => {
  const db = await openDeviceDB()
  if (!db) return false
  try {
    const transaction = db.transaction(DEVICE_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(DEVICE_STORE_NAME)
    await runRequest(store.put(value, key))
    await waitForTransaction(transaction)
    return true
  }
  catch { return false }
}

export const getDeviceValue = async (key: string): Promise<string | null> => {
  const value = await readFromIndexedDB(key)
  if (value !== null && value !== undefined) return value
  const fallbackValue = manageLocalStorage.get(key, null)
  if (fallbackValue != null) return fallbackValue
  return null
}

export const setDeviceValue = async (key: string, value: string) => {
  const wroteToIndexedDB = await writeToIndexedDB(key, value)
  if (wroteToIndexedDB) return
  manageLocalStorage.set({ key, value })
}
