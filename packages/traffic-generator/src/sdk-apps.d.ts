/**
 * Type declarations for @ottochain/sdk/apps
 * 
 * This is a workaround for TypeScript module resolution issues with pnpm + NodeNext.
 * The actual types are correctly resolved at runtime.
 */
declare module '@ottochain/sdk/apps' {
  export namespace contracts {
    export function getContractDefinition(): unknown;
    export function getEscrowDefinition(): unknown;
  }
  export namespace markets {
    export function getMarketDefinition(type?: 'Universal'): unknown;
  }
  export namespace governance {
    export function getDAODefinition(type: 'Single' | 'Multisig' | 'Threshold' | 'Token'): unknown;
  }
  export namespace identity {
    export function getIdentityDefinition(): unknown;
  }
  export namespace oracles {
    export function getOracleDefinition(type?: 'Oracle'): unknown;
  }
}
