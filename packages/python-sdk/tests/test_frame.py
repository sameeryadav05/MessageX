import json
import struct
import unittest

from messagex.frame import FrameDecoder, encode_frame


class FrameTests(unittest.TestCase):
    def test_encodes_json_with_big_endian_length_prefix(self):
        frame = encode_frame({"hello": "MessageX"})
        (length,) = struct.unpack(">I", frame[:4])
        self.assertEqual(length, len(frame) - 4)
        self.assertEqual(json.loads(frame[4:]), {"hello": "MessageX"})

    def test_decodes_partial_and_multiple_frames(self):
        first, second = encode_frame({"id": 1}), encode_frame({"id": 2})
        decoder = FrameDecoder()
        self.assertEqual(decoder.push(first[:2]), [])
        frames = decoder.push(first[2:] + second)
        self.assertEqual([json.loads(f) for f in frames], [{"id": 1}, {"id": 2}])
        self.assertEqual(decoder.buffered_bytes, 0)

    def test_rejects_frames_larger_than_limit(self):
        with self.assertRaisesRegex(ValueError, "Invalid MessageX frame length"):
            FrameDecoder(4).push(struct.pack(">I", 5))

    def test_rejects_zero_length_frames(self):
        with self.assertRaisesRegex(ValueError, "Invalid MessageX frame length"):
            FrameDecoder().push(struct.pack(">I", 0))

    def test_rejects_non_serializable_and_oversized_messages(self):
        with self.assertRaises(TypeError):
            encode_frame({"bad": object()})
        with self.assertRaises(TypeError):
            encode_frame({"bad": float("nan")})
        with self.assertRaises(ValueError):
            encode_frame({"big": "x" * 100}, max_frame_size=10)

    def test_unicode_is_utf8_and_length_counts_bytes(self):
        frame = encode_frame({"t": "héllo ✓"})
        (length,) = struct.unpack(">I", frame[:4])
        self.assertEqual(length, len(frame) - 4)
        self.assertEqual(json.loads(frame[4:].decode("utf-8")), {"t": "héllo ✓"})


if __name__ == "__main__":
    unittest.main()
