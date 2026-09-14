import { describe, expect, it } from 'vitest';
import { validateStudioInputs } from '../studioValidation';

describe('studio input validation', () => {
  it('allows defaults and whitespace around valid input', () => {
    expect(validateStudioInputs({ rateUrl: '', timeZone: ' SYSTEM ' })).toEqual({});
    expect(validateStudioInputs({ rateUrl: ' https://example.com/rates ', timeZone: ' Asia/Shanghai ' })).toEqual({});
  });
  it('reports both invalid fields instead of hiding one behind the other', () => {
    expect(Object.keys(validateStudioInputs({ rateUrl: 'javascript:alert(1)', timeZone: 'Unknown/City' }))).toEqual(['rateUrl', 'timeZone']);
  });
});
