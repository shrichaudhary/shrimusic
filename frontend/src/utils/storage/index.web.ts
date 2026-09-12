// Web storage adapter. General preferences use AsyncStorage; auth tokens use
// browser localStorage to match the secure-token contract.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AssertNoExtras, StorageBase, StorageItemValue } from "./storage-base";

export class Storage extends StorageBase {
  async getItem<Fallback extends StorageItemValue>(key: string, fallback: Fallback): Promise<Fallback | null> {
    try {
      return this.retrieve(await AsyncStorage.getItem(key), fallback);
    } catch (e) {
      this.warn("getItem", key, e);
      return fallback;
    }
  }

  async setItem<Value extends StorageItemValue>(key: string, value: Value): Promise<boolean> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("setItem", key, e);
      return false;
    }
  }

  async removeItem(key: string): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (e) {
      this.warn("removeItem", key, e);
      return false;
    }
  }

  async secureGet<Fallback extends StorageItemValue>(key: string, fallback: Fallback): Promise<Fallback | null> {
    try {
      return this.retrieve(window.localStorage.getItem(key), fallback);
    } catch (e) {
      this.warn("secureGet", key, e);
      return fallback;
    }
  }

  async secureSet<Value extends StorageItemValue>(key: string, value: Value): Promise<boolean> {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("secureSet", key, e);
      return false;
    }
  }

  async secureRemove(key: string): Promise<boolean> {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      this.warn("secureRemove", key, e);
      return false;
    }
  }
}

export const storage = new Storage();
type _NoExtras = AssertNoExtras<Exclude<keyof Storage, keyof StorageBase>>;