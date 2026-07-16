# GLB VAT Socket Configurator

Open `/examples/glb-vat-socket-configurator/` through `npm run dev`.

This editor previews an animated VAT character GLB with a rigid attachment GLB. It includes Ready Player and Samba Girl presets, the curated `/fantasy_sword.glb`, and local `.glb` inputs for both character and attachment.

Use the animated-socket picker to choose a node that has tracks in every baked clip. Translation, pitch/yaw/roll, XYZ scale, and scale-all controls update the attachment immediately. Socket and attachment origin markers help diagnose pivot and authored-scale differences.

The preview supports clip stepping, play/pause, animation speed, phase/FPS variation, one or five characters, visibility toggles, and camera reset. Its JSON export is a `VatAttachmentPreset`; local assets are represented by filename placeholders rather than file contents. The TypeScript export demonstrates `createVatCharacterSet`, socket baking, hierarchy attachments, and controller update order.

Fantasy Sword attribution is in [CREDITS.md](./CREDITS.md).
