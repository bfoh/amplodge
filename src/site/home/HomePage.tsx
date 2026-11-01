import { ArrivalFilm } from '../film/ArrivalFilm'
import { useDocumentMeta } from '../seo/useDocumentMeta'
import { ChooseYourStay } from './ChooseYourStay'
import { ComfortDetails } from './ComfortDetails'
import { FinalInvitation } from './FinalInvitation'
import { FindUs } from './FindUs'
import { Hospitality } from './Hospitality'
import { LensGallery } from './LensGallery'

export default function HomePage() {
  useDocumentMeta({
    title: 'AMP Lodge | Boutique Lodge in Abuakwa, Kumasi',
    description:
      'AMP Lodge is a welcoming retreat at Abuakwa DKC Junction on the Kumasi–Sunyani Road. Thoughtful rooms, genuine Ghanaian hospitality and direct online booking.',
    path: '/',
  })
  return (
    <>
      {/* 01–08: the arrival film (scroll-driven), 09: where it hands over to booking. */}
      <ArrivalFilm />
      <ChooseYourStay />
      <ComfortDetails />
      <LensGallery />
      <Hospitality />
      <FindUs />
      <FinalInvitation />
    </>
  )
}
