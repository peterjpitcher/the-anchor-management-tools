'use client'

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { supabase } from '@/lib/supabase';
import type { EmployeeAttachment, AttachmentCategory } from '@/types/database';
import { deleteEmployeeAttachment, type DeleteState } from '@/app/actions/employeeActions';
import {
  PaperClipIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { formatBytes } from '@/lib/utils'; // Ensuring this path is correct

interface EmployeeAttachmentsListProps {
  employeeId: string;
  attachments: EmployeeAttachment[] | null; // Pass attachments as prop
  categoriesMap: Map<string, string>; // Pass categories map for display
}

function DeleteAttachmentButton({ employeeId, attachmentId, storagePath, attachmentName }: {
  employeeId: string;
  attachmentId: string;
  storagePath: string;
  attachmentName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const deleteActionWithIds = deleteEmployeeAttachment.bind(null, employeeId, attachmentId, storagePath);
  const [state, dispatch] = useFormState(deleteActionWithIds, null);
  // const { pending } = useFormStatus(); // formStatus for the specific delete form is inside SubmitActualDeleteButton

  useEffect(() => {
    if (state?.type === 'success') {
      setIsOpen(false);
      // Revalidation is handled by server action, list should update.
      // toast.success(state.message); // Optional success message
    } else if (state?.type === 'error') {
      setIsOpen(false);
      alert(`Error: ${state.message}`); // Simple alert for now
    }
  }, [state]);

  // This Submit button is specific to the modal's form
  function SubmitActualDeleteButton() {
    const { pending: formSubmitting } = useFormStatus();
    return (
        <button
            type="submit"
            disabled={formSubmitting}
            className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto disabled:opacity-50"
        >
            {formSubmitting ? 'Deleting...' : 'Delete'}
        </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        type="button"
        className="font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
        title="Delete Attachment"
      >
        <TrashIcon className="h-5 w-5" />
        <span className="sr-only">Delete {attachmentName}</span>
      </button>

      {isOpen && (
        <div className="relative z-20" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <form 
                action={dispatch} // The form element for the modal
                className="relative transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6"
              >
                 <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg font-medium leading-6 text-gray-900" id="modal-title">
                      Delete Attachment
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete the attachment "{attachmentName}"? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
                {state?.type === 'error' && (
                    <p className="mt-3 text-sm text-red-600 text-center sm:text-left sm:ml-14">
                        {state.message}
                    </p>
                )}
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <SubmitActualDeleteButton />
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function EmployeeAttachmentsList({ attachments, categoriesMap, employeeId }: EmployeeAttachmentsListProps) {
  
  async function getSignedUrl(storagePath: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from('employee-attachments') 
      .createSignedUrl(storagePath, 60 * 5); // URL valid for 5 minutes
    if (error) {
      console.error('Error creating signed URL:', error);
      return null;
    }
    return data.signedUrl;
  }

  const handleDownload = async (attachment: EmployeeAttachment) => {
    const url = await getSignedUrl(attachment.storage_path);
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', attachment.file_name || 'download');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoke the object URL after download to free up resources if it were a blob URL
      // For signed URLs, this is not strictly necessary but good practice for blob URLs.
      // URL.revokeObjectURL(url); 
    } else {
      alert('Could not generate download link. Please try again.');
    }
  };

  if (!attachments) {
    return <p className="text-sm text-red-500 mt-1">Could not load attachments.</p>;
  }

  if (attachments.length === 0) {
    return <p className="text-sm text-gray-500 mt-1">No attachments for this employee yet.</p>;
  }

  return (
    <ul role="list" className="divide-y divide-gray-200 rounded-md border border-gray-200 mt-4">
      {attachments.map((attachment) => (
        <li key={attachment.attachment_id} className="flex items-center justify-between py-3 pl-3 pr-4 text-sm">
          <div className="flex w-0 flex-1 items-center">
            <PaperClipIcon className="h-5 w-5 flex-shrink-0 text-gray-400" aria-hidden="true" />
            <span className="ml-2 w-0 flex-1 truncate">
                {attachment.file_name} 
                <span className="text-xs text-gray-500 ml-2">({formatBytes(attachment.file_size_bytes)})</span>
                {attachment.description && <span className="block text-xs text-gray-500">{attachment.description}</span>}
                <span className="block text-xs text-gray-400">Category: {categoriesMap.get(attachment.category_id) || 'Unknown'}</span>
            </span>
          </div>
          <div className="ml-4 flex-shrink-0 flex items-center space-x-3">
            <button 
                onClick={() => handleDownload(attachment)}
                type="button" 
                className="font-medium text-secondary hover:text-secondary-emphasis"
                title="Download Attachment"
            >
              <ArrowDownTrayIcon className="h-5 w-5"/>
              <span className="sr-only">Download {attachment.file_name}</span>
            </button>
            <DeleteAttachmentButton 
              employeeId={employeeId}
              attachmentId={attachment.attachment_id}
              storagePath={attachment.storage_path}
              attachmentName={attachment.file_name}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Helper function (move to lib/utils.ts if not already there)
// export function formatBytes(bytes: number, decimals = 2): string {
//   if (bytes === 0) return '0 Bytes';
//   const k = 1024;
//   const dm = decimals < 0 ? 0 : decimals;
//   const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
//   const i = Math.floor(Math.log(bytes) / Math.log(k));
//   return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
// } 