/**
 * @file Renders the accessories the node-accessory plugin has registered.
 *
 * The plugin only tracks which node keys currently want an accessory and where
 * their mount element is; painting them is a view concern, so it lives here.
 * Each accessory is portalled into its node's own DOM element, which keeps it
 * out of the contenteditable subtree Lexical reconciles.
 */
import { createPortal } from 'react-dom';
import { useStore } from '../../reactive/store';
import type { AccessoryStore } from '../../plugins/node-accessory';

export function NodeAccessoryRenderer({
  accessories,
}: {
  accessories: AccessoryStore;
}) {
  const record = useStore(accessories);

  return (
    <>
      {Object.values(record).map(({ key, mountRef, component: Accessory }) =>
        createPortal(
          <Accessory mountRef={mountRef} nodeKey={key} />,
          mountRef,
          key
        )
      )}
    </>
  );
}
