'use client';

import React, { useRef } from 'react';
import {
  Button,
  FormSubmit,
  Modal,
  useDocumentInfo,
  useEditDepth,
  useFormModified,
  useHotkey,
  useModal,
  useOperation,
  useTranslation,
} from '@payloadcms/ui';
import type {
  CustomTranslationsKeys,
  CustomTranslationsObject,
} from '@/i18n/custom-translations';

const CENTRALIZED_USERS_MODAL_SLUG = 'author-users-centralized-no-save';

export default function UsersCentralizedSaveButton() {
  const { uploadStatus } = useDocumentInfo();
  const { t } = useTranslation<
    CustomTranslationsObject,
    CustomTranslationsKeys
  >();
  const { openModal, closeModal, isModalOpen } = useModal();
  const modified = useFormModified();
  const label = t('general:save');
  const ref = useRef<HTMLButtonElement | null>(null);
  const editDepth = useEditDepth();
  const operation = useOperation();
  const disabled =
    (operation === 'update' && !modified) || uploadStatus === 'uploading';

  useHotkey(
    {
      cmdCtrlKey: true,
      editDepth,
      keyCodes: ['s'],
    },
    (e) => {
      if (disabled) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      ref?.current?.click();
    }
  );

  const handleClick = () => {
    if (uploadStatus === 'uploading') {
      return;
    }
    openModal(CENTRALIZED_USERS_MODAL_SLUG);
  };

  const closeInfo = () => {
    closeModal(CENTRALIZED_USERS_MODAL_SLUG);
  };

  return (
    <>
      <FormSubmit
        buttonId="action-save"
        disabled={disabled}
        onClick={handleClick}
        ref={ref}
        size="medium"
        type="button"
      >
        {label}
      </FormSubmit>
      {isModalOpen(CENTRALIZED_USERS_MODAL_SLUG) ? (
        <Modal
          slug={CENTRALIZED_USERS_MODAL_SLUG}
          className="confirmation-modal"
          closeOnBlur
          aria-labelledby="author-users-centralized-modal-title"
          style={{ zIndex: 100 + editDepth }}
        >
          <div className="confirmation-modal__wrapper">
            <div className="confirmation-modal__content">
              <h1 id="author-users-centralized-modal-title">
                {t('author:usersCentralized.cannotSave.title')}
              </h1>
              <p>{t('author:usersCentralized.cannotSave.description')}</p>
            </div>
            <div
              className="confirmation-modal__controls"
              style={{ justifyContent: 'flex-end' }}
            >
              <Button
                buttonStyle="primary"
                id="author-users-centralized-modal-ok"
                onClick={closeInfo}
                size="large"
                type="button"
              >
                {t('author:usersCentralized.actions.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
