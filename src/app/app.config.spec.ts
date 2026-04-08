import '@angular/compiler';
import '../test-setup';
import { TestBed } from '@angular/core/testing';
import { FormFieldRegistry, BUILT_IN_FIELDS } from '@theredhead/ui-forms';
import { UIInput } from '@theredhead/ui-kit';
import { appConfig } from './app.config';

describe('appConfig', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: appConfig.providers,
    });
  });

  describe('form field registration', () => {
    it('should register the number field type', () => {
      const registry = TestBed.inject(FormFieldRegistry);
      const reg = registry.resolve('number');

      expect(reg).not.toBeNull();
      expect(reg!.component).toBe(UIInput);
      expect(reg!.modelProperty).toBe('value');
      expect(reg!.defaultConfig).toEqual({ type: 'number' });
    });

    it('should still have all built-in fields', () => {
      const registry = TestBed.inject(FormFieldRegistry);

      for (const key of Object.keys(BUILT_IN_FIELDS)) {
        expect(registry.resolve(key)).not.toBeNull();
      }
    });

    it('should register text field', () => {
      const registry = TestBed.inject(FormFieldRegistry);
      expect(registry.resolve('text')).not.toBeNull();
    });

    it('should register select field', () => {
      const registry = TestBed.inject(FormFieldRegistry);
      expect(registry.resolve('select')).not.toBeNull();
    });

    it('should register checkbox field', () => {
      const registry = TestBed.inject(FormFieldRegistry);
      expect(registry.resolve('checkbox')).not.toBeNull();
    });

    it('should register date field', () => {
      const registry = TestBed.inject(FormFieldRegistry);
      expect(registry.resolve('date')).not.toBeNull();
    });

    it('should register datetime field', () => {
      const registry = TestBed.inject(FormFieldRegistry);
      expect(registry.resolve('datetime')).not.toBeNull();
    });

    it('should register time field', () => {
      const registry = TestBed.inject(FormFieldRegistry);
      expect(registry.resolve('time')).not.toBeNull();
    });
  });
});
