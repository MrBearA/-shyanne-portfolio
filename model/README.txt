HOW TO SHOW YOUR OWN MODEL IN THE 3D VIEWER
===========================================

1. The model
   Put ONE model file in this "model" folder, named exactly:
     model.glb   (best: File > Export > glTF 2.0, format "glTF Binary (.glb)")
   or
     model.fbx   (File > Export > FBX; set Path Mode to "Copy" and click the
                  box icon next to it to embed textures)

   A .glb is used first if both are here.
   Right now model.fbx is the sample Bed, so replace it with yours.

2. The texture maps (optional)
   If the textures are already inside your .glb / .fbx, you're done.
   Otherwise put them in the "textures" folder with these exact names
   (.png or .jpg):

     basecolor.png           colour / albedo
     normal.png              normal map (OpenGL style, like Blender)
     roughness.png           black = glossy, white = rough
     metallic.png            black = not metal, white = metal
     emission.png            glowing parts (black = no glow)
     roughnessmetallic.png   one map with roughness in RED and metallic in GREEN
                             (use this instead of roughness.png + metallic.png)

   Files in "textures" override textures embedded in the model.

3. Test it
   Open index.html with VS Code's Live Server (opening the file directly won't
   load the model; browsers block that). Or drag your files onto the viewer:
   that works anywhere, even without this folder.

Tip: files dragged onto the viewer can have any names, as long as the name
contains basecolor / albedo / color, normal, roughness, metallic, emission.
