document.addEventListener("alpine:init", () => {
  Alpine.data("ticker", () => ({
    rows: [],
    previous: {},
    source: null,

    init() {
      this.connect()
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.disconnect()
        else this.connect()
      })
    },

    connect() {
      if (this.source) return
      this.source = new EventSource("/api/prices/stream")
      this.source.onmessage = (event) => this.apply(JSON.parse(event.data))
      this.source.onerror = () => this.disconnect()
    },

    disconnect() {
      if (!this.source) return
      this.source.close()
      this.source = null
    },

    apply(payload) {
      const quotes = payload.quotes || []
      this.rows = quotes.map((quote) => {
        const before = this.previous[quote.symbol]
        let flash = ""
        if (before && before !== quote.price) {
          flash = quote.direction === "down" ? "flash-down" : "flash-up"
        }
        this.previous[quote.symbol] = quote.price
        return {
          symbol: quote.symbol,
          price: quote.price,
          change: quote.change,
          direction: quote.direction,
          flash: flash,
        }
      })
    },

    destroy() {
      this.disconnect()
    },
  }))
})
