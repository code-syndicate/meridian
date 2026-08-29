document.addEventListener("alpine:init", () => {
  Alpine.data("ticker", () => ({ rows: [] }))
})
