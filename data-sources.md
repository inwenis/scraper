# Crude Oil Futures Data Sources

| # | Source | Type | Fit for CL tenor surface | Cost / access | Notes |
|---|---|---|---|---|---|
| 1 | [CME DataMine](https://www.cmegroup.com/datamine.html) | Official historical API/SFTP/S3 | Strong for history and settlements | Paid / licensed | Best compliant source for historical CL contracts |
| 2 | [CME Real-Time Futures and Options API](https://www.cmegroup.com/market-data/real-time-futures-and-options-data-api.html) | Official WebSocket | Strong for intraday snapshots | Paid / licensed | Direct source; top of book, trades, daily stats |
| 3 | [Databento GLBX.MDP3 CL](https://databento.com/catalog/cme/GLBX.MDP3/futures/CL) | Licensed vendor API/files | Strong | Paid | CME/NYMEX futures, CSV/JSON/Parquet |
| 4 | [Tradovate Market Data API](https://partner.tradovate.com/overview/core-concepts/web-sockets/market-data/market-data) | Broker/vendor WebSocket | Medium to strong | Account + market data entitlements | Good if account exists |
| 5 | [Interactive Brokers API](https://www.interactivebrokers.com/campus/ibkr-api-page/contracts/) | Broker API | Medium | Account + CME data subscription | Good contract discovery; watch pacing limits |
| 6 | [Polygon Futures API](https://polygon.io/futures) | Vendor API | Maybe | Beta / paid | Futures REST/WebSocket advertised; verify CL coverage |
| 7 | [Twelve Data Commodities API](https://twelvedata.com/commodities) | Vendor REST API | Weak to medium | Free tier then paid | Likely front/commodity series unless plan supports all contract symbols |
| 8 | [API Ninjas Crude Oil API](https://api-ninjas.com/commodity/crude-oil) | Vendor REST API | Weak | API key; historical premium | Crude oil series, not full tenor chain |
| 9 | [OilPriceAPI Futures](https://www.oilpriceapi.com/futures-historical-data-api) | Vendor API | Medium | Paid / trial | Verify WTI contract-month coverage |
| 10 | [CommodityPriceAPI](https://commoditypriceapi.com/symbols) | Vendor REST API | Weak | API key | `WTIOIL-FUT`, likely single/front series |
| 11 | [Yahoo Finance CL futures chain](https://ca.finance.yahoo.com/quote/CL%3DF/futures/) | Scrape candidate | Medium | Public delayed page | Unofficial and unstable; check ToS/robots first |
| 12 | [Investing.com crude contracts](https://www.investing.com/commodities/crude-oil-contracts) | Scrape candidate | Strong visually | Public delayed page | Has contract table; terms restrict reuse/commercial use |
| 13 | CentralCharts / Farmbucks / Oilprice.com pages | Scrape candidates | Medium | Public pages | Need ToS/robots and data-completeness check first |
