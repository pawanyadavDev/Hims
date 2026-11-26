export const bad = (message, status = 400) => Object.assign(new Error(message), { status });
export const money = (n) => Math.round(n * 100) / 100;
// Short readable reference number, e.g. AD1K3J9X2
export const refNo = (prefix) => prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 36).toString(36).toUpperCase();
