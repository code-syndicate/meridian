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

document.addEventListener("alpine:init", () => {
  function editing(target) {
    if (!target) return false
    const tag = target.tagName
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
  }

  Alpine.data("palette", () => ({
    closed: true,
    query: "",

    init() {
      window.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault()
          this.toggle()
          return
        }
        if (event.key === "/" && !editing(event.target) && this.closed) {
          event.preventDefault()
          this.toggle()
        }
      })
    },

    toggle() {
      this.closed = !this.closed
      if (!this.closed) queueMicrotask(() => this.$refs.input && this.$refs.input.focus())
    },

    close() {
      this.closed = true
    },

    // Reads the label off the element rather than evaluating an expression
    // over a data structure, which is what the CSP build requires.
    matches(el) {
      if (!this.query) return true
      const link = el.querySelector("a")
      const label = link ? link.dataset.label || "" : ""
      return label.toLowerCase().includes(this.query.toLowerCase())
    },
  }))

  Alpine.data("shortcuts", () => ({
    closed: true,
    pending: false,

    init() {
      window.addEventListener("keydown", (event) => {
        if (editing(event.target)) return

        if (event.key === "?") {
          event.preventDefault()
          this.closed = !this.closed
          return
        }

        if (event.key === "g") {
          this.pending = true
          window.setTimeout(() => { this.pending = false }, 1200)
          return
        }

        if (!this.pending) return
        this.pending = false
        const targets = { d: "/dashboard", m: "/markets", a: "/account" }
        const href = targets[event.key]
        if (href) {
          event.preventDefault()
          window.location.href = href
        }
      })
    },

    close() {
      this.closed = true
    },
  }))
})

document.addEventListener("alpine:init", () => {
  Alpine.data("reveal", () => ({
    init() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.$el.classList.add("shown")
        return
      }
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("shown")
              observer.unobserve(entry.target)
            }
          }
        },
        { threshold: 0.12 },
      )
      observer.observe(this.$el)
    },
  }))

  Alpine.data("copyField", () => ({
    copied: false,
    async copy() {
      const value = this.$refs.value?.dataset.copy ?? ""
      try {
        await navigator.clipboard.writeText(value)
      } catch {
        // Clipboard is denied in some contexts. Selecting the text at least
        // leaves the user one keystroke away.
        const range = document.createRange()
        range.selectNodeContents(this.$refs.value)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        return
      }
      this.copied = true
      setTimeout(() => { this.copied = false }, 1600)
    },
  }))

})

// The menu and section dropdowns are plain <details>, so they work before and
// without Alpine. This only closes them on an outside tap or Escape.
document.addEventListener("click", (event) => {
  for (const open of document.querySelectorAll("details.menu[open], details.tabs-menu[open]")) {
    if (!open.contains(event.target)) open.removeAttribute("open")
  }
})
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  for (const open of document.querySelectorAll("details.menu[open], details.tabs-menu[open]")) {
    open.removeAttribute("open")
    open.querySelector("summary")?.focus()
  }
})
