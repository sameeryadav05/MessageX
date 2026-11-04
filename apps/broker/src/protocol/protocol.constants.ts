// role ->	Frame size and protocol constants


export const PROTOCOL_VERSION = 1;

export const FRAME_HEADER_SIZE = 4;

export const MAX_FRAME_SIZE = 1024 * 1024; // 1 MiB

export const MIN_FRAME_SIZE = 1;

export const FRAME_BYTE_ORDER = "BE";

// PROTOCOL_VERSION: Current protocol version.

// FRAME_HEADER_SIZE: Four bytes for the length prefix.

// MAX_FRAME_SIZE: Maximum allowed JSON payload.

// MIN_FRAME_SIZE: Empty frames are not valid.

// FRAME_BYTE_ORDER: We use big-endian.

 