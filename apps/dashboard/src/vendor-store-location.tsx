import { useEffect, useState } from "react";
import type { StoreProfileValues } from "./StoreProfileFields";
import { reverseGeocodeAddress, validCoordinates, type Coordinates } from "./StoreLocationMap";

type AddressFields = Pick<StoreProfileValues, "addressLine1" | "addressLine2" | "locality" | "city" | "state" | "pincode">;

function addressFromValues(values: StoreProfileValues): AddressFields {
  return {
    addressLine1: values.addressLine1 ?? "",
    addressLine2: values.addressLine2 ?? "",
    locality: values.locality ?? "",
    city: values.city ?? "",
    state: values.state ?? "",
    pincode: values.pincode ?? "",
  };
}

function coordinatesFromValues(values: StoreProfileValues): Coordinates | null {
  return validCoordinates(values.latitude, values.longitude)
    ? { latitude: values.latitude!, longitude: values.longitude! }
    : null;
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return "Location permission was denied. Enter the store address below or allow location access in your browser settings.";
  if (error.code === error.POSITION_UNAVAILABLE) return "Your device could not determine its location. Enter the store address manually and try again later.";
  if (error.code === error.TIMEOUT) return "Location detection timed out. Try again or enter the store address manually.";
  return "The device location could not be detected. Enter the store address manually.";
}

export function VendorStoreLocation({ values, disabled, onBusyChange }: { values: StoreProfileValues; disabled: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [address, setAddress] = useState<AddressFields>(() => addressFromValues(values));
  const [coordinates, setCoordinates] = useState<Coordinates | null>(() => coordinatesFromValues(values));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setAddress(addressFromValues(values));
    setCoordinates(coordinatesFromValues(values));
  }, [values.addressLine1, values.addressLine2, values.locality, values.city, values.state, values.pincode, values.latitude, values.longitude]);

  const update = (field: keyof AddressFields, value: string) => {
    setAddress(current => ({ ...current, [field]: value }));
  };

  const detectLocation = () => {
    setError("");
    setStatus("");
    if (typeof window === "undefined" || !window.isSecureContext) {
      setError("Current-location detection requires a secure browser connection. You can still enter and save the address manually.");
      return;
    }
    if (!navigator.geolocation) {
      setError("This browser does not provide device location. You can still enter and save the address manually.");
      return;
    }

    setBusy(true);
    onBusyChange?.(true);
    navigator.geolocation.getCurrentPosition(position => {
      const detected = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (!validCoordinates(detected.latitude, detected.longitude)) {
        setBusy(false);
        onBusyChange?.(false);
        setError("The device returned invalid coordinates. Nothing was changed; enter the address manually or try again.");
        return;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      void reverseGeocodeAddress(detected, controller.signal).then(result => {
        setAddress({
          addressLine1: result.addressLine1,
          addressLine2: result.addressLine2,
          locality: result.locality,
          city: result.city,
          state: result.state,
          pincode: result.pincode,
        });
        setCoordinates(detected);
        setStatus(`Location found: ${result.label}. Review the address, then select Save Store Information.`);
      }).catch(() => {
        setError("Coordinates were detected, but a readable address could not be retrieved. Nothing was changed; enter the address manually and try again.");
      }).finally(() => {
        window.clearTimeout(timeout);
        setBusy(false);
        onBusyChange?.(false);
      });
    }, error => {
      setBusy(false);
      onBusyChange?.(false);
      setError(geolocationErrorMessage(error));
    }, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  };

  const input = (label: string, name: keyof AddressFields, required = false) => (
    <label className="vendor-label" key={name}>
      <span>{label}{required && <span className="lb-required-mark" aria-hidden="true"> *</span>}</span>
      <input
        className="vendor-input"
        name={name}
        value={address[name] ?? ""}
        onChange={event => update(name, event.currentTarget.value)}
        required={required}
        maxLength={name === "addressLine1" ? 250 : name === "addressLine2" ? 250 : name === "locality" || name === "city" || name === "state" ? 120 : 6}
        disabled={disabled || busy}
        {...(name === "pincode" ? { inputMode: "numeric" as const, pattern: "[1-9][0-9]{5}", minLength: 6 } : {})}
      />
    </label>
  );

  return (
    <div className="vendor-address-group vendor-store-location">
      <strong className="vendor-address-title">Store location</strong>
      <p className="vendor-text-muted">Detect your current location or enter the store address below. Review detected details before saving.</p>
      <button className="vendor-secondary-button vendor-location-detect" type="button" onClick={detectLocation} disabled={disabled || busy}>
        {busy ? "Detecting location…" : "Use Current Location"}
      </button>
      {status && <p className="vendor-location-status" role="status">{status}</p>}
      {error && <p className="vendor-location-error" role="alert">{error}</p>}
      <div className="vendor-profile-fields-grid">
        {input("Store address or building / street", "addressLine1", true)}
        {input("Address line 2 · optional landmark", "addressLine2")}
        {input("Area / locality", "locality", true)}
        {input("City", "city", true)}
        {input("State", "state", true)}
        {input("PIN code", "pincode", true)}
      </div>
      <div className="vendor-location-coordinate-summary">
        {coordinates
          ? <>Saved exact coordinates: <code>{coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}</code>. Manual address edits do not change these coordinates; detect the current location if the pin should move.</>
          : "No exact coordinates saved. Manual address entry does not require coordinates."}
      </div>
      <p className="vendor-location-disclosure">Location lookup uses Photon (Komoot). Your detected address and coordinates are saved only when you review and save this profile.</p>
      <input type="hidden" name="latitude" value={coordinates?.latitude ?? ""} readOnly />
      <input type="hidden" name="longitude" value={coordinates?.longitude ?? ""} readOnly />
    </div>
  );
}
