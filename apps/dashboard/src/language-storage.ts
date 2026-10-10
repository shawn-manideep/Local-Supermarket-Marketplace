/** Browser-local language preferences stay separate from auth/session storage. */
export const dashboardLanguageStorage = {
  async getItem(key: string) {
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string) {
    window.localStorage.setItem(key, value);
  },
};
