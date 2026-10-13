"""Local dashboard over the pipeline's data directory.

Run it from apps/pipeline with plain ``python3 -m dashboard``. Standard library
only. Every figure comes from a ``lib/`` function the command-line tools use.
Looking never writes; the Lab writes only under ``output/lab/`` and, when a
draft is applied, ``config.json``.
"""
