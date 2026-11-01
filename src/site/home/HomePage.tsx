import { ArrivalFilm } from '../film/ArrivalFilm'
import { RoomJourney } from '../film/RoomJourney'
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
      'AMP Lodge: accommodation, bed & breakfast and a meeting venue at Abuakwa DKC Junction on the Kumasi–Sunyani Road, Kumasi. Thoughtful rooms, genuine hospitality and direct online booking.',
    path: '/',
  })
  return (
    <>
      {/* 01–07: the arrival film; 08: every room, as a film you can steer; 09: where it hands over to booking. */}
      <ArrivalFilm />
      <RoomJourney />
      <ChooseYourStay />
      <ComfortDetails />
      <LensGallery />
      <Hospitality />
      <FindUs />
      <FinalInvitation />
    </>
  )
}
