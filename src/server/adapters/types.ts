import type {
  ContextPackage,
  DestinationAdapterId,
  DestinationPreparedContext,
} from '../../shared/context-share-types.js';

export interface ContextDestinationAdapter {
  id: DestinationAdapterId;
  name: string;
  description: string;
  validate(): Promise<boolean>;
  prepareContext(context: ContextPackage): Promise<DestinationPreparedContext>;
}
