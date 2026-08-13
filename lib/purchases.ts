// Enterprise implementation: All features are unlocked and managed by enterprise administrators.
// In-app consumer paywalls and purchases are disabled.

export const PURCHASES_SUPPORTED = false;

export type PurchasePackage = {
  id: string;
  title: string;
  priceString: string;
  productId: string;
};

export async function configurePurchases(_appUserId?: string): Promise<void> {
  // no-op
}

export async function logoutPurchases(): Promise<void> {
  // no-op
}

export async function isPremiumActive(): Promise<boolean> {
  return true;
}

export async function getOfferingPackages(): Promise<PurchasePackage[]> {
  return [];
}

export async function purchasePackageById(_id: string, _productId?: string): Promise<boolean> {
  return true;
}

export async function restorePurchases(): Promise<boolean> {
  return true;
}
