import tempfile
import unittest
from pathlib import Path

from apiserver.apierrors_generator.generator import Generator


class ApiErrorsGeneratorTests(unittest.TestCase):
    def test_generation_lock_accepts_file_descriptor(self):
        with tempfile.TemporaryDirectory(dir=str(Path.cwd())) as temp_dir:
            Generator(temp_dir, format_pep8=False).make_errors({})
