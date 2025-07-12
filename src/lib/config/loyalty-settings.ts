// Loyalty Program Settings
// This file manages the configuration and operational state of the loyalty program

export interface LoyaltySettings {
  // Configuration access - always available for setup
  configurationEnabled: boolean;
  
  // Operational features - controls point earning and messaging
  operationalEnabled: boolean;
  
  // Metadata
  lastUpdated?: Date;
  updatedBy?: string;
  
  // Feature flags for granular control
  features?: {
    pointsEarning?: boolean;
    smsNotifications?: boolean;
    autoEnrollment?: boolean;
    achievements?: boolean;
  };
}

// In production, this would be stored in the database
// For now, we'll use localStorage to persist the setting
const SETTINGS_KEY = 'anchor_loyalty_settings';

export class LoyaltySettingsService {
  static getSettings(): LoyaltySettings {
    if (typeof window === 'undefined') {
      // Server-side: default settings
      return { 
        configurationEnabled: true,  // Always allow configuration
        operationalEnabled: false    // But operations are off by default
      };
    }
    
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Ensure configuration is always enabled for existing installations
        return {
          ...parsed,
          configurationEnabled: true
        };
      } catch {
        // Invalid data, return default
      }
    }
    
    // Default: configuration enabled, operations disabled
    return { 
      configurationEnabled: true,
      operationalEnabled: false,
      features: {
        pointsEarning: false,
        smsNotifications: false,
        autoEnrollment: false,
        achievements: false
      }
    };
  }
  
  static updateSettings(updates: Partial<LoyaltySettings>, updatedBy?: string): void {
    if (typeof window === 'undefined') return;
    
    const current = this.getSettings();
    const settings: LoyaltySettings = {
      ...current,
      ...updates,
      configurationEnabled: true, // Always keep configuration enabled
      lastUpdated: new Date(),
      updatedBy
    };
    
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    
    // Trigger a custom event so components can react
    window.dispatchEvent(new CustomEvent('loyalty-settings-changed', { 
      detail: settings 
    }));
  }
  
  static setOperationalEnabled(enabled: boolean, updatedBy?: string): void {
    this.updateSettings({ 
      operationalEnabled: enabled,
      features: enabled ? {
        pointsEarning: true,
        smsNotifications: true,
        autoEnrollment: true,
        achievements: true
      } : {
        pointsEarning: false,
        smsNotifications: false,
        autoEnrollment: false,
        achievements: false
      }
    }, updatedBy);
  }
  
  // Backwards compatibility
  static setEnabled(enabled: boolean, updatedBy?: string): void {
    this.setOperationalEnabled(enabled, updatedBy);
  }
  
  static isEnabled(): boolean {
    return this.isOperationalEnabled();
  }
  
  // New granular checks
  static isConfigurationEnabled(): boolean {
    return this.getSettings().configurationEnabled;
  }
  
  static isOperationalEnabled(): boolean {
    return this.getSettings().operationalEnabled;
  }
  
  static isPointsEarningEnabled(): boolean {
    const settings = this.getSettings();
    return settings.operationalEnabled && (settings.features?.pointsEarning ?? true);
  }
  
  static isSmsEnabled(): boolean {
    const settings = this.getSettings();
    return settings.operationalEnabled && (settings.features?.smsNotifications ?? true);
  }
  
  static isAutoEnrollmentEnabled(): boolean {
    const settings = this.getSettings();
    return settings.operationalEnabled && (settings.features?.autoEnrollment ?? true);
  }
  
  static isAchievementsEnabled(): boolean {
    const settings = this.getSettings();
    return settings.operationalEnabled && (settings.features?.achievements ?? true);
  }
}