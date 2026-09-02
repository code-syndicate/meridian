import type { Client, Executor } from "../index"
import { all as allRows, get } from "../index"

export interface Asset {
  symbol: string
  displaySymbol: string
  name: string
  kind: "native" | "token"
  chain: string
  networkLabel: string
  contractAddress: string | null
  nativeDecimals: number
  displayDecimals: number
  confirmationsRequired: number
  isStablecoin: boolean
  depositEnabled: boolean
  withdrawalEnabled: boolean
  tradingEnabled: boolean
  sortOrder: number
}

interface AssetRow {
  symbol: string
  display_symbol: string
  name: string
  kind: "native" | "token"
  chain: string
  network_label: string
  contract_address: string | null
  native_decimals: number
  display_decimals: number
  confirmations_required: number
  is_stablecoin: number
  deposit_enabled: number
  withdrawal_enabled: number
  trading_enabled: number
  sort_order: number
}

function toAsset(row: AssetRow): Asset {
  return {
    symbol: row.symbol,
    displaySymbol: row.display_symbol,
    name: row.name,
    kind: row.kind,
    chain: row.chain,
    networkLabel: row.network_label,
    contractAddress: row.contract_address,
    nativeDecimals: row.native_decimals,
    displayDecimals: row.display_decimals,
    confirmationsRequired: row.confirmations_required,
    isStablecoin: row.is_stablecoin === 1,
    depositEnabled: row.deposit_enabled === 1,
    withdrawalEnabled: row.withdrawal_enabled === 1,
    tradingEnabled: row.trading_enabled === 1,
    sortOrder: row.sort_order,
  }
}

const COLUMNS = `symbol, display_symbol, name, kind, chain, network_label, contract_address,
  native_decimals, display_decimals, confirmations_required, is_stablecoin,
  deposit_enabled, withdrawal_enabled, trading_enabled, sort_order`

export class AssetRepository {
  constructor(private readonly db: Client) {}

  async all(ex: Executor = this.db): Promise<Asset[]> {
    const rows = await allRows<AssetRow>(
      ex,
      `SELECT ${COLUMNS} FROM assets ORDER BY sort_order`,
    )
    return rows.map(toAsset)
  }

  async find(symbol: string, ex: Executor = this.db): Promise<Asset | null> {
    const row = await get<AssetRow>(ex, `SELECT ${COLUMNS} FROM assets WHERE symbol = ?`, [symbol])
    return row ? toAsset(row) : null
  }

  async byChain(chain: string, ex: Executor = this.db): Promise<Asset[]> {
    const rows = await allRows<AssetRow>(
      ex,
      `SELECT ${COLUMNS} FROM assets WHERE chain = ? ORDER BY sort_order`,
      [chain],
    )
    return rows.map(toAsset)
  }
}
