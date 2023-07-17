import pyatv, {
  NodePyATVDevice,
  NodePyATVDeviceEvent,
  NodePyATVEventValueType,
  NodePyATVPowerState,
} from "@sebbo2002/node-pyatv";
import { debounce } from "throttle-debounce";
import { Service, PlatformAccessory, CharacteristicValue } from "homebridge";

import { AppleTVPlatform } from "./platform";

/**
 * AppleTV Accessory
 */
export class AppleTVAccessory {
  private atv: NodePyATVDevice;
  private services: Service[] = [];
  private powerStateService: Service;
  private genericServices: {
    [property: string]: { [value: string]: Service };
  } = {};
  private debounceUpdatePowerState: (
    powerState: NodePyATVEventValueType
  ) => void;

  constructor(
    private readonly platform: AppleTVPlatform,
    private readonly accessory: PlatformAccessory
  ) {
    this.atv = pyatv.device({
      name: this.accessory.context.device.name,
      host: this.accessory.context.device.host,
      airplayCredentials: this.accessory.context.device.credentials,
      companionCredentials: this.accessory.context.device.credentials,
    });

    this.platform.log.debug(
      "Debounce power state delay: ",
      this.accessory.context.device.debouncePowerStateDelay,
      "ms"
    );

    this.platform.log.debug(
      "Typeof debounce power state delay: ",
      typeof this.accessory.context.device.debouncePowerStateDelay
    );

    this.debounceUpdatePowerState = debounce(
      this.accessory.context.device.debouncePowerStateDelay,
      (powerState: NodePyATVEventValueType) => {
        this.updatePowerState(powerState);
      },
      { atBegin: true }
    );

    this.services.push(
      this.accessory
        .getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(
          this.platform.Characteristic.Manufacturer,
          "Apple Inc."
        )
        .setCharacteristic(this.platform.Characteristic.Model, "AppleTV")
        .setCharacteristic(
          this.platform.Characteristic.SerialNumber,
          this.atv.id ?? "Serial"
        )
    );

    this.powerStateService =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory
        .addService(this.platform.Service.Switch)
        .setCharacteristic(this.platform.Characteristic.Name, "Power State");
    this.services.push(this.powerStateService);
    this.powerStateService
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this));

    this.platform.log.debug("Register to update:powerState");
    this.atv.on("update:powerState", (event: NodePyATVDeviceEvent | Error) => {
      if (event instanceof Error) {
        this.platform.log.debug(
          "Error updating power state",
          event?.name,
          event?.message
        );
        return;
      }
      typeof this.accessory.context.device.debouncePowerStateDelay === "number"
        ? this.debounceUpdatePowerState(event.newValue)
        : this.updatePowerState(event.newValue);
    });

    if (!this.accessory.context.device.generic_sensors) {
      this.accessory.context.device.generic_sensors = [];
    }

    if (this.accessory.context.device.device_state_sensors?.length > 0) {
      this.accessory.context.device.generic_sensors.push({
        property: "deviceState",
        values: this.accessory.context.device.device_state_sensors,
      });
      this.platform.log.debug(
        "generic_sensors: ",
        this.accessory.context.device.generic_sensors
      );
    }

    if (this.accessory.context.device.app_sensors?.length > 0) {
      this.accessory.context.device.generic_sensors.push({
        property: "app",
        values: this.accessory.context.device.app_sensors,
      });
      this.platform.log.debug(
        "generic_sensors: ",
        this.accessory.context.device.generic_sensors
      );
    }

    for (const sensor of this.accessory.context.device.generic_sensors || []) {
      const property = sensor.property;
      this.genericServices[property] = {};
      for (const value of sensor.values) {
        const name = `${property}.${value}`;
        this.genericServices[sensor.property][value] =
          this.accessory.getService(name) ||
          this.accessory
            .addService(this.platform.Service.MotionSensor, name, value)
            .setCharacteristic(this.platform.Characteristic.Name, value);
        this.services.push(this.genericServices[property][value]);
      }

      this.atv.on(
        `update:${property}`,
        (event: NodePyATVDeviceEvent | Error) => {
          if (event instanceof Error) {
            return;
          }
          for (const value in this.genericServices[property]) {
            this.genericServices[property][value].setCharacteristic(
              this.platform.Characteristic.MotionDetected,
              event.newValue === value
            );
          }
        }
      );
    }

    for (const service of this.accessory.services.filter(
      (x) => !this.services.includes(x)
    )) {
      this.platform.log.info(`Removing unused service: ${service.displayName}`);
      this.accessory.removeService(service);
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   */
  async setOn(value: CharacteristicValue) {
    value ? await this.atv.turnOn() : await this.atv.turnOff();
    this.platform.log.debug("Set Characteristic On ->", value);
  }

  updatePowerState(powerState: NodePyATVEventValueType) {
    this.platform.log.debug("update:powerState", powerState);
    this.powerStateService
      .getCharacteristic(this.platform.Characteristic.On)
      .updateValue(powerState === NodePyATVPowerState.on);
  }
}
