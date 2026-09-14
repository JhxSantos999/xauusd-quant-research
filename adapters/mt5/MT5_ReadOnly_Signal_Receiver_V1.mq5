#property strict
#property version   "1.00"
#property description "XAUUSD Quant Research - MT5 Read-Only Signal Receiver V1"
#property description "Display/log only. No trading, no order submission, no broker actions."

input string InpSignalFile = "xauusd_readonly_signal_v1.csv";
input int    InpPollSeconds = 1;

const string MAGIC = "MT5_READONLY_SIGNAL_V1";
const string EXPECTED_EXECUTION_ID = "final_signal_v1r1_20260913235306128";
const string EXPECTED_MODEL_SHA256 = "f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655";
const string EXPECTED_CALIBRATOR_SHA256 = "6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c";
const long   DEV_INFORMATION_END_MS = 1788931800000;

string g_last_event_id = "";

bool IsLowerHex64(const string value)
{
   if(StringLen(value) != 64)
      return false;

   for(int i = 0; i < 64; i++)
   {
      ushort c = StringGetCharacter(value, i);
      bool digit = (c >= 48 && c <= 57);
      bool lower_hex = (c >= 97 && c <= 102);
      if(!digit && !lower_hex)
         return false;
   }
   return true;
}

bool IsDecision(const string value)
{
   return value == "LONG" || value == "SHORT" || value == "NO_TRADE";
}

void ShowReceiverStatus(const string status)
{
   Comment(
      "XAUUSD Quant Research\n",
      "MT5 Read-Only Signal Receiver V1\n",
      status,
      "\n\nDISPLAY / LOG ONLY\n",
      "Order submission: DISABLED"
   );
}

int OnInit()
{
   if(InpPollSeconds < 1)
   {
      Print("MT5_READONLY_RECEIVER_V1_INVALID_POLL_SECONDS");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(!EventSetTimer(InpPollSeconds))
   {
      PrintFormat("MT5_READONLY_RECEIVER_V1_TIMER_FAILED error=%d", GetLastError());
      return INIT_FAILED;
   }

   ShowReceiverStatus("Waiting for signal file: " + InpSignalFile);
   Print("MT5_READONLY_RECEIVER_V1_STARTED");
   Print("Policy: DISPLAY_AND_LOG_ONLY");
   Print("Trading actions are not implemented in this receiver.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
   PrintFormat("MT5_READONLY_RECEIVER_V1_STOPPED reason=%d", reason);
}

void OnTimer()
{
   ResetLastError();
   int handle = FileOpen(
      InpSignalFile,
      FILE_READ | FILE_CSV | FILE_ANSI | FILE_SHARE_READ,
      ';'
   );

   if(handle == INVALID_HANDLE)
   {
      ShowReceiverStatus("Waiting for signal file: " + InpSignalFile);
      return;
   }

   string magic = FileReadString(handle);
   string event_id = FileReadString(handle);
   string asset = FileReadString(handle);
   string timeframe = FileReadString(handle);
   string decision = FileReadString(handle);
   string decision_time_text = FileReadString(handle);
   string raw_probability_text = FileReadString(handle);
   string calibrated_probability_text = FileReadString(handle);
   string decision_close_text = FileReadString(handle);
   string risk_fraction_text = FileReadString(handle);
   string max_quote_risk_text = FileReadString(handle);
   string max_gross_notional_text = FileReadString(handle);
   string stop_distance_text = FileReadString(handle);
   string time_exit_text = FileReadString(handle);
   string execution_id = FileReadString(handle);
   string model_sha256 = FileReadString(handle);
   string calibrator_sha256 = FileReadString(handle);
   string bridge_sha256 = FileReadString(handle);
   string monitor_sha256 = FileReadString(handle);
   FileClose(handle);

   if(magic != MAGIC)
   {
      ShowReceiverStatus("REJECTED: MAGIC_MISMATCH");
      return;
   }
   if(asset != "XAUUSD" || timeframe != "M5")
   {
      ShowReceiverStatus("REJECTED: ASSET_TIMEFRAME_MISMATCH");
      return;
   }
   if(!IsDecision(decision))
   {
      ShowReceiverStatus("REJECTED: INVALID_DECISION");
      return;
   }
   if(execution_id != EXPECTED_EXECUTION_ID
      || model_sha256 != EXPECTED_MODEL_SHA256
      || calibrator_sha256 != EXPECTED_CALIBRATOR_SHA256)
   {
      ShowReceiverStatus("REJECTED: FINAL_SIGNAL_LINEAGE_MISMATCH");
      return;
   }
   if(!IsLowerHex64(event_id)
      || !IsLowerHex64(model_sha256)
      || !IsLowerHex64(calibrator_sha256)
      || !IsLowerHex64(bridge_sha256)
      || !IsLowerHex64(monitor_sha256))
   {
      ShowReceiverStatus("REJECTED: INVALID_HASH_FORMAT");
      return;
   }

   long decision_time_ms = (long)StringToInteger(decision_time_text);
   double raw_probability = StringToDouble(raw_probability_text);
   double calibrated_probability = StringToDouble(calibrated_probability_text);
   double decision_close = StringToDouble(decision_close_text);

   if(decision_time_ms <= 0 || decision_time_ms > DEV_INFORMATION_END_MS)
   {
      ShowReceiverStatus("REJECTED: POST_DEV_OR_INVALID_DECISION_TIME");
      return;
   }
   if(raw_probability < 0.0 || raw_probability > 1.0
      || calibrated_probability < 0.0 || calibrated_probability > 1.0
      || decision_close <= 0.0)
   {
      ShowReceiverStatus("REJECTED: INVALID_NUMERIC_SIGNAL_FIELDS");
      return;
   }

   if(decision == "NO_TRADE")
   {
      if(risk_fraction_text != "NA"
         || max_quote_risk_text != "NA"
         || max_gross_notional_text != "NA"
         || stop_distance_text != "NA"
         || time_exit_text != "NA")
      {
         ShowReceiverStatus("REJECTED: NO_TRADE_RISK_FIELDS_PRESENT");
         return;
      }
   }
   else
   {
      if(risk_fraction_text == "NA"
         || max_quote_risk_text == "NA"
         || max_gross_notional_text == "NA"
         || stop_distance_text == "NA"
         || time_exit_text == "NA")
      {
         ShowReceiverStatus("REJECTED: TRADE_TELEMETRY_MISSING");
         return;
      }

      double risk_fraction = StringToDouble(risk_fraction_text);
      double max_quote_risk = StringToDouble(max_quote_risk_text);
      double max_gross_notional = StringToDouble(max_gross_notional_text);
      double stop_distance = StringToDouble(stop_distance_text);
      long time_exit_ms = (long)StringToInteger(time_exit_text);

      if(risk_fraction <= 0.0
         || max_quote_risk <= 0.0
         || max_gross_notional <= 0.0
         || stop_distance <= 0.0
         || time_exit_ms <= decision_time_ms)
      {
         ShowReceiverStatus("REJECTED: INVALID_RISK_TELEMETRY");
         return;
      }
   }

   datetime decision_time = (datetime)(decision_time_ms / 1000);
   string display =
      "VALID READ-ONLY SIGNAL\n"
      + "Asset: XAUUSD M5\n"
      + "Decision: " + decision + "\n"
      + "Calibrated p: " + DoubleToString(calibrated_probability, 10) + "\n"
      + "Raw p: " + DoubleToString(raw_probability, 10) + "\n"
      + "Decision close: " + DoubleToString(decision_close, 2) + "\n"
      + "Decision time UTC: " + TimeToString(decision_time, TIME_DATE | TIME_MINUTES | TIME_SECONDS) + "\n"
      + "Event: " + event_id + "\n\n"
      + "DISPLAY / LOG ONLY\n"
      + "Order submission: DISABLED";

   Comment(display);

   if(event_id != g_last_event_id)
   {
      PrintFormat(
         "MT5_READONLY_SIGNAL_V1_VALID eventId=%s decision=%s calibratedProbability=%.10f decisionTimeMs=%I64d",
         event_id,
         decision,
         calibrated_probability,
         decision_time_ms
      );
      g_last_event_id = event_id;
   }
}
