CREATE TABLE assets (
  symbol                  TEXT PRIMARY KEY,
  display_symbol          TEXT NOT NULL,
  name                    TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('native', 'token')),
  chain                   TEXT NOT NULL,
  network_label           TEXT NOT NULL,
  contract_address        TEXT,
  native_decimals         INTEGER NOT NULL CHECK (native_decimals >= 0 AND native_decimals <= 36),
  display_decimals        INTEGER NOT NULL CHECK (display_decimals >= 0 AND display_decimals <= 8),
  confirmations_required  INTEGER NOT NULL CHECK (confirmations_required > 0),
  is_stablecoin           INTEGER NOT NULL DEFAULT 0 CHECK (is_stablecoin IN (0, 1)),
  deposit_enabled         INTEGER NOT NULL DEFAULT 0 CHECK (deposit_enabled IN (0, 1)),
  withdrawal_enabled      INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_enabled IN (0, 1)),
  trading_enabled         INTEGER NOT NULL DEFAULT 0 CHECK (trading_enabled IN (0, 1)),
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  CHECK ((kind = 'token') = (contract_address IS NOT NULL))
);

CREATE INDEX idx_assets_chain ON assets(chain);

INSERT INTO assets (
  symbol, display_symbol, name, kind, chain, network_label, contract_address,
  native_decimals, display_decimals, confirmations_required, is_stablecoin,
  sort_order, created_at
) VALUES
  ('BTC',        'BTC',  'Bitcoin',    'native', 'bitcoin',  'Bitcoin',       NULL,
   8,  8, 2,  0, 10, '2026-08-29T00:00:00.000Z'),
  ('ETH',        'ETH',  'Ethereum',   'native', 'ethereum', 'Ethereum (ERC20)', NULL,
   18, 6, 12, 0, 20, '2026-08-29T00:00:00.000Z'),
  ('USDT_ERC20', 'USDT', 'Tether',     'token',  'ethereum', 'Ethereum (ERC20)',
   '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 2, 12, 1, 30, '2026-08-29T00:00:00.000Z'),
  ('USDC_ERC20', 'USDC', 'USD Coin',   'token',  'ethereum', 'Ethereum (ERC20)',
   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 2, 12, 1, 40, '2026-08-29T00:00:00.000Z'),
  ('TRX',        'TRX',  'Tron',       'native', 'tron',     'Tron (TRC20)',  NULL,
   6,  2, 20, 0, 50, '2026-08-29T00:00:00.000Z'),
  ('USDT_TRC20', 'USDT', 'Tether',     'token',  'tron',     'Tron (TRC20)',
   'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 6, 2, 20, 1, 60, '2026-08-29T00:00:00.000Z'),
  ('SOL',        'SOL',  'Solana',     'native', 'solana',   'Solana',        NULL,
   9,  4, 32, 0, 70, '2026-08-29T00:00:00.000Z'),
  ('USDC_SPL',   'USDC', 'USD Coin',   'token',  'solana',   'Solana (SPL)',
   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6, 2, 32, 1, 80, '2026-08-29T00:00:00.000Z'),
  ('BNB',        'BNB',  'BNB',        'native', 'bsc',      'BNB Chain (BEP20)', NULL,
   18, 6, 15, 0, 90, '2026-08-29T00:00:00.000Z'),
  ('USDT_BEP20', 'USDT', 'Tether',     'token',  'bsc',      'BNB Chain (BEP20)',
   '0x55d398326f99059fF775485246999027B3197955', 18, 2, 15, 1, 100, '2026-08-29T00:00:00.000Z');
