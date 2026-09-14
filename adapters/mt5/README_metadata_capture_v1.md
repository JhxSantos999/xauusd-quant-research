# MT5 XAUUSD Metadata Capture V1

Operational utility only. This branch descends from Economic Evaluation V1 frozen commit `2e3ab2608fafd1215545b94b7a13d66b22a010c8` and does not alter the frozen research protocol.

## Purpose
Capture broker-server metadata required before the full economic evaluation/live deployment path can be unlocked, without placing any order and without reading the Future Lockbox.

Required fields:
- SYMBOL_TRADE_TICK_SIZE
- SYMBOL_TRADE_TICK_VALUE
- SYMBOL_TRADE_TICK_VALUE_PROFIT
- SYMBOL_TRADE_TICK_VALUE_LOSS
- trading sessions via `SymbolInfoSessionTrade`

The script also records contract size, point, volume constraints, stops/freeze levels, execution/filling modes, swap metadata, broker company/server and leverage. It intentionally does not record login, balance, equity, name, password, positions or trade history.

## Run
1. Open MT5 connected to the INFINOX live server.
2. Open MetaEditor (F4).
3. Create/open a Script and use `CaptureXauusdMetadataV1.mq5`.
4. Compile with F7. Compilation must show 0 errors.
5. In MT5 Navigator > Scripts, run `CaptureXauusdMetadataV1` on any chart.
6. Keep input symbol as `XAUUSD` unless the broker symbol has a suffix.
7. The script writes `XAUUSD_symbol_metadata_v1.txt` under the terminal's `MQL5/Files` directory and prints the same values in the Experts log.

## Retrieve output
In MT5: File > Open Data Folder > MQL5 > Files > `XAUUSD_symbol_metadata_v1.txt`.

Do not edit the output before audit. Send the raw TXT file.

## Safety
The script calls no trading functions. It does not send, modify or cancel orders. It does not require account funding.
