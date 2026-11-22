ADDING A MODEL TO THE 3D GALLERY
================================

Every model gets its own folder inside "models", and one entry in
models.json. The first model in the list is the one the viewer opens with.

1. Make a folder, e.g.  models/sword/
2. Put the model in it:  sword.glb   or   sword.fbx
     Blender .glb:  File > Export > glTF 2.0, Format: glTF Binary (.glb)
     Blender .fbx:  File > Export > FBX, Path Mode: Copy + click the box icon
                    next to it (Embed Textures)
3. Texture maps (only if they are NOT already inside the .glb / .fbx):
   put them in  models/sword/textures/  using these names (.png or .jpg):
     basecolor      colour / albedo
     normal         normal map (OpenGL style, like Blender)
     roughness      black = glossy, white = rough
     metallic       black = not metal, white = metal
     emission       glowing parts (black = no glow)
     roughnessmetallic   one map: roughness in RED, metallic in GREEN
                         (use instead of roughness + metallic)
4. Optional thumbnail for the gallery tile: models/sword/thumb.jpg
   (no thumbnail? the viewer renders one automatically)
5. Add an entry to models.json. Copy the Bed block, put a comma between
   blocks, and change the values:

  {
    "title": "Goreforged Sword",
    "description": "Hand-painted game-ready sword",
    "file": "models/sword/sword.glb",
    "thumbnail": "models/sword/thumb.jpg",
    "tags": ["Blender", "Substance", "2.4k tris"]
  }

   - "textures" is optional. Leave it out and the viewer looks in the
     model's textures/ folder for the standard names above.
   - Or list them yourself (paths start from the model's folder):
       "textures": { "basecolor": "textures/Sword_Albedo.png",
                     "normal": "textures/Sword_Normal.png",
                     "roughness": "textures/Sword_Rough.png" }

TESTING
Open index.html with VS Code's Live Server. Opening the file by
double-clicking won't load models (browsers block that).
Online (GitHub Pages / Netlify) it just works.

Tip: you can also drag a model + maps straight onto the viewer to preview
them. Those only show on your own screen and aren't saved to the site.
