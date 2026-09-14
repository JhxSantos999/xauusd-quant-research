#property script_show_inputs
#property strict

input string InpSymbol = "XAUUSD";
input string InpOutputFile = "XAUUSD_symbol_metadata_v1.txt";

string DayName(const ENUM_DAY_OF_WEEK day)
{
   switch(day)
   {
      case SUNDAY:    return "SUNDAY";
      case MONDAY:    return "MONDAY";
      case TUESDAY:   return "TUESDAY";
      case WEDNESDAY: return "WEDNESDAY";
      case THURSDAY:  return "THURSDAY";
      case FRIDAY:    return "FRIDAY";
      case SATURDAY:  return "SATURDAY";
   }
   return "UNKNOWN";
}

string SessionTime(const datetime value)
{
   return TimeToString(value, TIME_MINUTES|TIME_SECONDS);
}

void AppendLine(const int handle, const string key, const string value)
{
   FileWriteString(handle, key + "=" + value + "\r\n");
   Print(key, "=", value);
}

void AppendDouble(const int handle, const string key, const double value, const int digits=10)
{
   AppendLine(handle, key, DoubleToString(value, digits));
}

void AppendInteger(const int handle, const string key, const long value)
{
   AppendLine(handle, key, IntegerToString(value));
}

void OnStart()
{
   if(!SymbolSelect(InpSymbol, true))
   {
      Print("METADATA_CAPTURE_FAILED: SymbolSelect failed for ", InpSymbol, ", error=", GetLastError());
      return;
   }

   const int handle = FileOpen(InpOutputFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      Print("METADATA_CAPTURE_FAILED: FileOpen failed, error=", GetLastError());
      return;
   }

   AppendLine(handle, "FORMAT_VERSION", "mt5_symbol_metadata_capture_v1");
   AppendLine(handle, "SYMBOL", InpSymbol);
   AppendLine(handle, "CAPTURE_TIME_UTC", TimeToString(TimeGMT(), TIME_DATE|TIME_SECONDS));
   AppendLine(handle, "TERMINAL_COMPANY", TerminalInfoString(TERMINAL_COMPANY));
   AppendLine(handle, "ACCOUNT_SERVER", AccountInfoString(ACCOUNT_SERVER));
   AppendInteger(handle, "ACCOUNT_LEVERAGE", AccountInfoInteger(ACCOUNT_LEVERAGE));

   AppendInteger(handle, "SYMBOL_DIGITS", SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS));
   AppendDouble(handle, "SYMBOL_POINT", SymbolInfoDouble(InpSymbol, SYMBOL_POINT), 10);
   AppendDouble(handle, "SYMBOL_TRADE_CONTRACT_SIZE", SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_CONTRACT_SIZE), 10);
   AppendDouble(handle, "SYMBOL_TRADE_TICK_SIZE", SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_SIZE), 10);
   AppendDouble(handle, "SYMBOL_TRADE_TICK_VALUE", SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE), 10);
   AppendDouble(handle, "SYMBOL_TRADE_TICK_VALUE_PROFIT", SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE_PROFIT), 10);
   AppendDouble(handle, "SYMBOL_TRADE_TICK_VALUE_LOSS", SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE_LOSS), 10);

   AppendDouble(handle, "SYMBOL_VOLUME_MIN", SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN), 10);
   AppendDouble(handle, "SYMBOL_VOLUME_MAX", SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MAX), 10);
   AppendDouble(handle, "SYMBOL_VOLUME_STEP", SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP), 10);
   AppendDouble(handle, "SYMBOL_VOLUME_LIMIT", SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_LIMIT), 10);

   AppendInteger(handle, "SYMBOL_TRADE_STOPS_LEVEL", SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL));
   AppendInteger(handle, "SYMBOL_TRADE_FREEZE_LEVEL", SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_FREEZE_LEVEL));
   AppendInteger(handle, "SYMBOL_TRADE_MODE", SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_MODE));
   AppendInteger(handle, "SYMBOL_TRADE_EXEMODE", SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_EXEMODE));
   AppendInteger(handle, "SYMBOL_FILLING_MODE", SymbolInfoInteger(InpSymbol, SYMBOL_FILLING_MODE));
   AppendInteger(handle, "SYMBOL_TRADE_CALC_MODE", SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_CALC_MODE));

   AppendInteger(handle, "SYMBOL_SWAP_MODE", SymbolInfoInteger(InpSymbol, SYMBOL_SWAP_MODE));
   AppendDouble(handle, "SYMBOL_SWAP_LONG", SymbolInfoDouble(InpSymbol, SYMBOL_SWAP_LONG), 10);
   AppendDouble(handle, "SYMBOL_SWAP_SHORT", SymbolInfoDouble(InpSymbol, SYMBOL_SWAP_SHORT), 10);
   AppendInteger(handle, "SYMBOL_SWAP_ROLLOVER3DAYS", SymbolInfoInteger(InpSymbol, SYMBOL_SWAP_ROLLOVER3DAYS));

   AppendLine(handle, "SESSIONS_BEGIN", "1");
   int sessionCount = 0;
   for(int d = (int)SUNDAY; d <= (int)SATURDAY; ++d)
   {
      const ENUM_DAY_OF_WEEK day = (ENUM_DAY_OF_WEEK)d;
      for(uint index = 0; index < 32; ++index)
      {
         datetime from = 0;
         datetime to = 0;
         ResetLastError();
         if(!SymbolInfoSessionTrade(InpSymbol, day, index, from, to))
            break;
         const string prefix = "SESSION_" + DayName(day) + "_" + IntegerToString((long)index);
         AppendLine(handle, prefix + "_FROM", SessionTime(from));
         AppendLine(handle, prefix + "_TO", SessionTime(to));
         sessionCount++;
      }
   }
   AppendInteger(handle, "SYMBOL_TRADE_SESSIONS_COUNT", sessionCount);
   AppendLine(handle, "SESSIONS_END", "1");

   FileFlush(handle);
   FileClose(handle);

   Print("METADATA_CAPTURE_SUCCESS: MQL5/Files/", InpOutputFile);
}
