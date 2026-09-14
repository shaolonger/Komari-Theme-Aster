import { isCostRateApiUrlValid } from './cost';
import { isValidIanaTimeZone, SYSTEM_DISPLAY_TIME_ZONE } from './timeDisplay';

export function validateStudioInputs(input: { rateUrl: string; timeZone: string }) {
  const errors: { rateUrl?: string; timeZone?: string } = {};
  const rateUrl = input.rateUrl.trim();
  const timeZone = input.timeZone.trim();
  if (rateUrl && !isCostRateApiUrlValid(rateUrl)) errors.rateUrl = '汇率来源不是有效的 HTTP 或 HTTPS 地址';
  if (timeZone && timeZone.toLowerCase() !== SYSTEM_DISPLAY_TIME_ZONE && !isValidIanaTimeZone(timeZone)) errors.timeZone = '显示时区不是有效的 IANA 时区';
  return errors;
}
