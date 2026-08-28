import React from 'react';

// Enterprise implementation: All features are unlocked and accessible for authenticated users.
export function PremiumFeatureGate({ children }: { feature?: string; children: React.ReactNode }) {
  return <>{children}</>;
}

