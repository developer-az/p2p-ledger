import type {
  PasskeyCreationOptions,
  PasskeyCredentialJson,
  PasskeyRequestOptions,
} from '../api.js';

/** WebAuthn JSON uses base64url; the browser APIs use ArrayBuffer. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function passkeySupport(): boolean {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential === 'function'
    && typeof navigator !== 'undefined'
    && typeof navigator.credentials?.get === 'function'
    && typeof navigator.credentials?.create === 'function';
}

export function creationOptionsFromJson(json: PasskeyCreationOptions): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64UrlToBytes(json.challenge),
    rp: json.rp,
    user: {
      id: base64UrlToBytes(json.user.id),
      name: json.user.name,
      displayName: json.user.displayName,
    },
    pubKeyCredParams: json.pubKeyCredParams.map((param) => ({
      type: param.type,
      alg: param.alg,
    })),
    timeout: json.timeout,
    attestation: json.attestation,
    authenticatorSelection: json.authenticatorSelection,
    excludeCredentials: json.excludeCredentials.map((credential) => ({
      type: credential.type,
      id: base64UrlToBytes(credential.id),
      transports: credential.transports as AuthenticatorTransport[],
    })),
  };
}

export function requestOptionsFromJson(json: PasskeyRequestOptions): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToBytes(json.challenge),
    rpId: json.rpId,
    timeout: json.timeout,
    userVerification: json.userVerification,
    allowCredentials: json.allowCredentials.map((credential) => ({
      type: credential.type,
      id: base64UrlToBytes(credential.id),
      transports: credential.transports as AuthenticatorTransport[],
    })),
  };
}

export function credentialToJson(credential: PublicKeyCredential): PasskeyCredentialJson {
  const response = credential.response;
  const registration = response as AuthenticatorAttestationResponse;
  const assertion = response as AuthenticatorAssertionResponse;
  if (typeof registration.attestationObject === 'string' || registration.attestationObject instanceof ArrayBuffer) {
    const transports = typeof registration.getTransports === 'function'
      ? registration.getTransports()
      : [];
    return {
      id: credential.id,
      rawId: bytesToBase64Url(credential.rawId),
      type: 'public-key',
      response: {
        clientDataJSON: bytesToBase64Url(response.clientDataJSON),
        attestationObject: bytesToBase64Url(registration.attestationObject),
        transports,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(assertion.authenticatorData),
      signature: bytesToBase64Url(assertion.signature),
      userHandle: assertion.userHandle ? bytesToBase64Url(assertion.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

/** A cancelled browser prompt is not an app error. */
export function isPasskeyCancelled(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'NotAllowedError' || name === 'AbortError';
}
