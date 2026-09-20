# Parametric facade bay 0.1.0

This independent toolkit moves a bounded facade-bay construction method into the existing `sketchup_toolkit` registry. A weak model supplies six dimensions; the compiler derives bay, opening, pier and lintel relationships and returns managed Ruby plus a manifest. The generated massing creates editable groups and a real projection subject. It does not claim interior, structural, material, or visual acceptance.

Use `list` to read the method scope, `validate` for positive/negative parameter feedback, and `compile` to an empty absolute output directory. Pass the returned `build.rb` through the existing `sketchup_project_step` for live readback and review. No package import grants execution automatically; registered copies still require explicit code trust and fingerprint matching.
