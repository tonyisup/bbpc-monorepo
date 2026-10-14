"""Local dashboard over the pipeline's data directory.

Run it from apps/pipeline with plain ``python3 -m dashboard``. Standard library
only. Every figure comes from a ``lib/`` function the command-line tools use.
Looking never writes. The Lab writes only under ``output/lab/`` and, when a
draft is applied, ``config.json``; the Clips tab records publish decisions in
``output/publish-decisions.json``; the Shirts tab writes the shortlist,
``output/tshirt/ideas.json``, and its Rescan rewrites ``output/phrases/``.
"""
