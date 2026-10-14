"""Secret values are replaced by their names before output is shown or logged."""
import unittest

from lib.redaction import Redactor, redact

SECRETS = {"CONVEX_URL": "https://quiet-otter-123.convex.cloud", "CLERK_MACHINE_SECRET_KEY": "ak_live_abcdefghij",
           "CLERK_M2M_TOKEN_TTL_SECONDS": "900", "EMPTY": "", "PEM": "-----BEGIN-----\nMIIBsecretline\n-----END-----"}


def stream(chunks, secrets=SECRETS):
    redactor = Redactor(secrets)
    return b"".join(redactor.feed(chunk) for chunk in chunks) + redactor.flush()


class RedactTests(unittest.TestCase):
    def test_each_value_becomes_its_name(self):
        self.assertEqual(redact("Transcript import target verified: https://quiet-otter-123.convex.cloud\n", SECRETS),
                         "Transcript import target verified: [CONVEX_URL]\n")
        self.assertEqual(redact("a ak_live_abcdefghij b ak_live_abcdefghij", SECRETS),
                         "a [CLERK_MACHINE_SECRET_KEY] b [CLERK_MACHINE_SECRET_KEY]")

    def test_short_and_empty_values_are_left_alone(self):
        # "900" would turn every 900 in a log into a name, and it is no secret.
        self.assertEqual(redact("took 900 s", SECRETS), "took 900 s")

    def test_each_line_of_a_value_that_spans_lines_is_hidden(self):
        self.assertEqual(redact("key MIIBsecretline here", SECRETS), "key [PEM] here")

    def test_the_longer_of_two_overlapping_values_wins(self):
        secrets = {"SHORT": "abcdefgh", "LONG": "abcdefghijkl"}
        self.assertEqual(redact("abcdefghijkl abcdefgh", secrets), "[LONG] [SHORT]")


class RedactorTests(unittest.TestCase):
    def test_a_value_split_across_reads_is_still_hidden(self):
        text = b"target https://quiet-otter-123.convex.cloud ok\n"
        for cut in range(1, len(text)):
            with self.subTest(cut=cut):
                self.assertEqual(stream([text[:cut], text[cut:]]), b"target [CONVEX_URL] ok\n")

    def test_one_byte_at_a_time(self):
        text = b"x ak_live_abcdefghij\rprogress 50%\rhttps://quiet-otter-123.convex.cloud"
        self.assertEqual(stream([bytes([b]) for b in text]),
                         b"x [CLERK_MACHINE_SECRET_KEY]\rprogress 50%\r[CONVEX_URL]")

    def test_finished_lines_come_out_at_once_for_a_live_log(self):
        redactor = Redactor(SECRETS)
        self.assertEqual(redactor.feed(b"[1/8] Transcribing\n50%\r"), b"[1/8] Transcribing\n50%\r")
        self.assertEqual(redactor.feed(b"half a li"), b"")
        self.assertEqual(redactor.flush(), b"half a li")

    def test_a_long_line_with_no_end_is_not_held_back_forever(self):
        redactor = Redactor(SECRETS)
        out = redactor.feed(b"." * 10_000)
        self.assertGreater(len(out), 9_000)
        self.assertEqual(out + redactor.flush(), b"." * 10_000)

    def test_with_no_secrets_output_passes_straight_through(self):
        self.assertEqual(stream([b"abc", b"def\n"], {}), b"abcdef\n")
