/**
 * @deprecated Timer-based capture completion has been removed.
 * Use @rayzan/capture watchdogs (NEW_TURN_WATCHDOG_MS / GENERATION_WATCHDOG_MS).
 * Kept only so older imports do not break during transition.
 */

export {
  GENERATION_WATCHDOG_MS as generationWatchdogMs,
  NEW_TURN_WATCHDOG_MS as newTurnWatchdogMs,
} from '@rayzan/capture';
